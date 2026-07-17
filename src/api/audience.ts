import type { AuthContext, Env } from '../types';
import { audit } from '../db';
import { HttpError, readJson, requireRole } from '../http';
import { json, nowIso, randomId } from '../security';

export type ContactSortField = 'created_at' | 'first_name' | 'last_name' | 'consent_status';
export type SortDirection = 'asc' | 'desc';
/** Re-engagement targeting relative to an earlier campaign. */
export type EngagementFilter = 'any' | 'opened' | 'not_opened' | 'clicked' | 'not_clicked';

export interface AudienceRules {
  tagIds: string[];
  tagMode: 'any' | 'all';
  excludeTagIds: string[];
  consentStatuses: string[];
  createdAfter: string | null;
  createdBefore: string | null;
  hasName: boolean | null;
  sortBy: ContactSortField;
  sortDirection: SortDirection;
  maxRecipients: number | null;
  engagementCampaignId: string | null;
  engagementFilter: EngagementFilter;
}

const ALLOWED_CONSENT = new Set(['express', 'implied', 'transactional', 'unknown']);
const ALLOWED_SORT = new Set<ContactSortField>(['created_at', 'first_name', 'last_name', 'consent_status']);
const ALLOWED_ENGAGEMENT = new Set<EngagementFilter>(['any', 'opened', 'not_opened', 'clicked', 'not_clicked']);

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
}

function safeIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function sanitizeAudienceRules(input: unknown): AudienceRules {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const sortBy = ALLOWED_SORT.has(source.sortBy as ContactSortField) ? (source.sortBy as ContactSortField) : 'created_at';
  const sortDirection: SortDirection = String(source.sortDirection).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const rawLimit = Number(source.maxRecipients);
  // Engagement targeting needs both a filter and a campaign; otherwise it is inert.
  const rawFilter = ALLOWED_ENGAGEMENT.has(source.engagementFilter as EngagementFilter) ? (source.engagementFilter as EngagementFilter) : 'any';
  const rawCampaign = String(source.engagementCampaignId ?? '').trim();
  const engagementActive = rawFilter !== 'any' && rawCampaign.length > 0;
  return {
    engagementCampaignId: engagementActive ? rawCampaign : null,
    engagementFilter: engagementActive ? rawFilter : 'any',
    tagIds: stringIds(source.tagIds),
    tagMode: source.tagMode === 'all' ? 'all' : 'any',
    excludeTagIds: stringIds(source.excludeTagIds),
    consentStatuses: stringIds(source.consentStatuses).filter((status) => ALLOWED_CONSENT.has(status)),
    createdAfter: safeIso(source.createdAfter),
    createdBefore: safeIso(source.createdBefore),
    hasName: typeof source.hasName === 'boolean' ? source.hasName : null,
    sortBy,
    sortDirection,
    maxRecipients: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100_000) : null,
  };
}

export async function validateAudienceRules(env: Env, workspaceId: string, rules: AudienceRules): Promise<void> {
  if (rules.engagementCampaignId) {
    const campaign = await env.DB.prepare('SELECT 1 FROM campaigns WHERE id = ? AND workspace_id = ?')
      .bind(rules.engagementCampaignId, workspaceId)
      .first();
    if (!campaign) throw new HttpError(400, 'The campaign used for re-engagement targeting is unavailable.');
  }
  const ids = [...new Set([...rules.tagIds, ...rules.excludeTagIds])];
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM tags WHERE workspace_id = ? AND id IN (${placeholders})`)
    .bind(workspaceId, ...ids)
    .first<{ count: number }>();
  if ((row?.count ?? 0) !== ids.length) throw new HttpError(400, 'One or more audience tags are unavailable.');
}

/**
 * Resolve the effective audience for a campaign: a saved segment defines the base
 * audience when chosen, and re-engagement targeting from the composer applies on
 * top of it (e.g. "VIP customers who did not open the launch email").
 */
export async function resolveAudienceRules(
  env: Env,
  workspaceId: string,
  segmentId: string | null,
  rawRules: unknown,
): Promise<AudienceRules> {
  const requested = sanitizeAudienceRules(rawRules);
  if (!segmentId) return requested;
  const segment = await env.DB.prepare('SELECT rules_json FROM segments WHERE id = ? AND workspace_id = ?')
    .bind(segmentId, workspaceId)
    .first<{ rules_json: string }>();
  if (!segment) throw new HttpError(400, 'The selected segment is unavailable.');
  const base = sanitizeAudienceRules(JSON.parse(segment.rules_json || '{}'));
  return { ...base, engagementCampaignId: requested.engagementCampaignId, engagementFilter: requested.engagementFilter };
}

function audienceWhere(workspaceId: string, rules: AudienceRules): { sql: string; params: unknown[] } {
  const where = [
    'c.workspace_id = ?',
    "c.status = 'active'",
    'NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.workspace_id = c.workspace_id AND s.email_hash = c.email_hash)',
  ];
  const params: unknown[] = [workspaceId];

  if (rules.consentStatuses.length) {
    where.push(`c.consent_status IN (${rules.consentStatuses.map(() => '?').join(',')})`);
    params.push(...rules.consentStatuses);
  }
  if (rules.createdAfter) {
    where.push('c.created_at >= ?');
    params.push(rules.createdAfter);
  }
  if (rules.createdBefore) {
    where.push('c.created_at <= ?');
    params.push(rules.createdBefore);
  }
  if (rules.hasName === true) where.push("(COALESCE(TRIM(c.first_name), '') != '' OR COALESCE(TRIM(c.last_name), '') != '')");
  if (rules.hasName === false) where.push("COALESCE(TRIM(c.first_name), '') = '' AND COALESCE(TRIM(c.last_name), '') = ''");

  if (rules.tagIds.length && rules.tagMode === 'any') {
    where.push(`EXISTS (
      SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id AND t.workspace_id = ? AND ct.tag_id IN (${rules.tagIds.map(() => '?').join(',')})
    )`);
    params.push(workspaceId, ...rules.tagIds);
  }
  if (rules.tagIds.length && rules.tagMode === 'all') {
    where.push(`(
      SELECT COUNT(DISTINCT ct.tag_id) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id AND t.workspace_id = ? AND ct.tag_id IN (${rules.tagIds.map(() => '?').join(',')})
    ) = ?`);
    params.push(workspaceId, ...rules.tagIds, rules.tagIds.length);
  }
  if (rules.excludeTagIds.length) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id AND t.workspace_id = ? AND ct.tag_id IN (${rules.excludeTagIds.map(() => '?').join(',')})
    )`);
    params.push(workspaceId, ...rules.excludeTagIds);
  }

  if (rules.engagementCampaignId && rules.engagementFilter !== 'any') {
    const campaignId = rules.engagementCampaignId;
    // "Did not open/click" only makes sense for people who actually received the
    // campaign — otherwise it would sweep in everyone who was never sent it.
    const delivered = "EXISTS (SELECT 1 FROM send_events se WHERE se.campaign_id = ? AND se.contact_id = c.id AND se.status = 'accepted')";
    const opened = 'EXISTS (SELECT 1 FROM email_opens o WHERE o.campaign_id = ? AND o.contact_id = c.id)';
    const clicked = 'EXISTS (SELECT 1 FROM email_clicks cl WHERE cl.campaign_id = ? AND cl.contact_id = c.id)';
    if (rules.engagementFilter === 'opened') {
      where.push(opened);
      params.push(campaignId);
    } else if (rules.engagementFilter === 'clicked') {
      where.push(clicked);
      params.push(campaignId);
    } else if (rules.engagementFilter === 'not_opened') {
      where.push(`${delivered} AND NOT ${opened}`);
      params.push(campaignId, campaignId);
    } else if (rules.engagementFilter === 'not_clicked') {
      where.push(`${delivered} AND NOT ${clicked}`);
      params.push(campaignId, campaignId);
    }
  }
  return { sql: where.join(' AND '), params };
}

function orderSql(rules: AudienceRules): string {
  const columns: Record<ContactSortField, string> = {
    created_at: 'c.created_at',
    first_name: "LOWER(COALESCE(c.first_name, ''))",
    last_name: "LOWER(COALESCE(c.last_name, ''))",
    consent_status: 'c.consent_status',
  };
  return `${columns[rules.sortBy]} ${rules.sortDirection.toUpperCase()}, c.id ${rules.sortDirection.toUpperCase()}`;
}

export async function countAudience(env: Env, workspaceId: string, rawRules: unknown): Promise<number> {
  const rules = sanitizeAudienceRules(rawRules);
  const query = audienceWhere(workspaceId, rules);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contacts c WHERE ${query.sql}`)
    .bind(...query.params)
    .first<{ count: number }>();
  const count = row?.count ?? 0;
  return rules.maxRecipients ? Math.min(count, rules.maxRecipients) : count;
}

export async function getEligibleContactIds(env: Env, workspaceId: string, rawRules: unknown): Promise<string[]> {
  const rules = sanitizeAudienceRules(rawRules);
  const query = audienceWhere(workspaceId, rules);
  const maximum = rules.maxRecipients ?? 100_000;
  const ids: string[] = [];
  let offset = 0;
  while (ids.length < maximum) {
    const pageSize = Math.min(500, maximum - ids.length);
    const rows = await env.DB.prepare(
      `SELECT c.id FROM contacts c WHERE ${query.sql} ORDER BY ${orderSql(rules)} LIMIT ? OFFSET ?`,
    )
      .bind(...query.params, pageSize, offset)
      .all<{ id: string }>();
    if (!rows.results.length) break;
    ids.push(...rows.results.map((row) => row.id));
    offset += rows.results.length;
    if (rows.results.length < pageSize) break;
  }
  return ids;
}

export async function handleSegmentsList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    'SELECT id, name, description, rules_json, created_at, updated_at FROM segments WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(context.workspaceId)
    .all<{ id: string; name: string; description: string | null; rules_json: string; created_at: string; updated_at: string }>();
  const segments = await Promise.all(rows.results.map(async (row) => {
    const rules = sanitizeAudienceRules(JSON.parse(row.rules_json || '{}'));
    return { ...row, rules, count: await countAudience(env, context.workspaceId, rules) };
  }));
  return json({ segments });
}

export async function handleSegmentCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{ name?: string; description?: string; rules?: unknown }>(request);
  const name = String(body.name ?? '').trim().slice(0, 120);
  const description = String(body.description ?? '').trim().slice(0, 500) || null;
  if (!name) throw new HttpError(400, 'Enter a segment name.');
  const rules = sanitizeAudienceRules(body.rules);
  await validateAudienceRules(env, context.workspaceId, rules);
  const id = randomId('seg_');
  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO segments (id, workspace_id, name, description, rules_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, context.workspaceId, name, description, JSON.stringify(rules), now, now)
    .run();
  await audit(env, request, context, 'segment.create', 'segment', id, { rules });
  return json({ id, count: await countAudience(env, context.workspaceId, rules) }, 201);
}

export async function handleSegmentUpdate(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const current = await env.DB.prepare('SELECT name, description, rules_json FROM segments WHERE id = ? AND workspace_id = ?')
    .bind(id, context.workspaceId)
    .first<{ name: string; description: string | null; rules_json: string }>();
  if (!current) throw new HttpError(404, 'Segment not found.');
  const body = await readJson<{ name?: string; description?: string; rules?: unknown }>(request);
  const name = body.name === undefined ? current.name : String(body.name).trim().slice(0, 120);
  const description = body.description === undefined ? current.description : String(body.description).trim().slice(0, 500) || null;
  const rules = body.rules === undefined ? sanitizeAudienceRules(JSON.parse(current.rules_json || '{}')) : sanitizeAudienceRules(body.rules);
  if (!name) throw new HttpError(400, 'Enter a segment name.');
  await validateAudienceRules(env, context.workspaceId, rules);
  await env.DB.prepare('UPDATE segments SET name = ?, description = ?, rules_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(name, description, JSON.stringify(rules), nowIso(), id, context.workspaceId)
    .run();
  await audit(env, request, context, 'segment.update', 'segment', id, { rules });
  return json({ ok: true, count: await countAudience(env, context.workspaceId, rules) });
}

export async function handleSegmentDelete(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const result = await env.DB.prepare('DELETE FROM segments WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, 'Segment not found.');
  await audit(env, request, context, 'segment.delete', 'segment', id);
  return json({ ok: true });
}
