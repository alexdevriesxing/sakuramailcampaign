import type { AuthContext, Env } from '../types';
import { decryptEmail, encryptEmail, hmacHex, isValidEmail, json, normalizeEmail, nowIso, randomId } from '../security';
import { HttpError, maskEmail, readJson, requireRole } from '../http';
import { audit } from '../db';

const ALLOWED_CONSENT = new Set(['express', 'implied', 'transactional', 'unknown']);
const ALLOWED_STATUS = new Set(['active', 'unsubscribed', 'bounced', 'complained']);
const CONTACT_SORTS: Record<string, string> = {
  created_at: 'c.created_at',
  first_name: "LOWER(COALESCE(c.first_name, ''))",
  last_name: "LOWER(COALESCE(c.last_name, ''))",
  consent_status: 'c.consent_status',
  status: 'c.status',
};

function tagSlug(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeTagNames(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|]/) : [];
  const bySlug = new Map<string, string>();
  for (const raw of source) {
    const name = String(raw).trim().replace(/\s+/g, ' ').slice(0, 40);
    const slug = tagSlug(name);
    if (name && slug && !bySlug.has(slug)) bySlug.set(slug, name);
    if (bySlug.size >= 20) break;
  }
  return [...bySlug.values()];
}

async function ensureTags(env: Env, workspaceId: string, names: string[]): Promise<Map<string, string>> {
  const unique = new Map<string, string>();
  for (const name of names) {
    const slug = tagSlug(name);
    if (slug && !unique.has(slug)) unique.set(slug, name);
  }
  if (!unique.size) return new Map();
  const now = nowIso();
  const inserts = [...unique].map(([slug, name]) => env.DB.prepare(
    'INSERT OR IGNORE INTO tags (id, workspace_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(randomId('tag_'), workspaceId, name, slug, now));
  for (let index = 0; index < inserts.length; index += 75) await env.DB.batch(inserts.slice(index, index + 75));
  const slugs = [...unique.keys()];
  const rows = await env.DB.prepare(`SELECT id, slug FROM tags WHERE workspace_id = ? AND slug IN (${slugs.map(() => '?').join(',')})`)
    .bind(workspaceId, ...slugs)
    .all<{ id: string; slug: string }>();
  return new Map(rows.results.map((row) => [row.slug, row.id]));
}

export async function handleContactsList(request: Request, env: Env, context: AuthContext): Promise<Response> {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const status = String(url.searchParams.get('status') ?? '');
  const consent = String(url.searchParams.get('consent') ?? '');
  const tagId = String(url.searchParams.get('tagId') ?? '').trim();
  const sortBy = CONTACT_SORTS[url.searchParams.get('sortBy') ?? 'created_at'] ? (url.searchParams.get('sortBy') ?? 'created_at') : 'created_at';
  const sortDirection = url.searchParams.get('sortDirection') === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  const where = ['c.workspace_id = ?'];
  const params: unknown[] = [context.workspaceId];
  if (ALLOWED_STATUS.has(status)) {
    where.push('c.status = ?');
    params.push(status);
  }
  if (ALLOWED_CONSENT.has(consent)) {
    where.push('c.consent_status = ?');
    params.push(consent);
  }
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND ct.tag_id = ? AND t.workspace_id = ?)');
    params.push(tagId, context.workspaceId);
  }
  if (q) {
    if (isValidEmail(q)) {
      where.push('c.email_hash = ?');
      params.push(await hmacHex(env.AUTH_PEPPER, `contact:${normalizeEmail(q)}`));
    } else {
      const pattern = `%${q.toLocaleLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      where.push("(LOWER(COALESCE(c.first_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
  }

  const whereSql = where.join(' AND ');
  const [rows, filtered, workspaceTotal] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.email_ciphertext, c.email_iv, c.first_name, c.last_name, c.consent_status, c.consent_source, c.status, c.created_at
       FROM contacts c WHERE ${whereSql}
       ORDER BY ${CONTACT_SORTS[sortBy]} ${sortDirection}, c.id ${sortDirection} LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all<{
      id: string;
      email_ciphertext: string;
      email_iv: string;
      first_name: string | null;
      last_name: string | null;
      consent_status: string;
      consent_source: string | null;
      status: string;
      created_at: string;
    }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM contacts c WHERE ${whereSql}`).bind(...params).first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ?').bind(context.workspaceId).first<{ count: number }>(),
  ]);

  const tagMap = new Map<string, Array<{ id: string; name: string }>>();
  if (rows.results.length) {
    const ids = rows.results.map((row) => row.id);
    const tags = await env.DB.prepare(
      `SELECT ct.contact_id, t.id, t.name FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE t.workspace_id = ? AND ct.contact_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`,
    )
      .bind(context.workspaceId, ...ids)
      .all<{ contact_id: string; id: string; name: string }>();
    for (const tag of tags.results) {
      const list = tagMap.get(tag.contact_id) ?? [];
      list.push({ id: tag.id, name: tag.name });
      tagMap.set(tag.contact_id, list);
    }
  }

  const contacts = await Promise.all(rows.results.map(async (row) => ({
    id: row.id,
    masked_email: maskEmail(await decryptEmail(env, row.email_ciphertext, row.email_iv)),
    first_name: row.first_name,
    last_name: row.last_name,
    consent_status: row.consent_status,
    consent_source: row.consent_source,
    status: row.status,
    created_at: row.created_at,
    tags: tagMap.get(row.id) ?? [],
  })));
  return json({
    contacts,
    total: filtered?.count ?? contacts.length,
    workspaceTotal: workspaceTotal?.count ?? 0,
    page,
    limit,
    pages: Math.max(1, Math.ceil((filtered?.count ?? 0) / limit)),
    filters: { q, status, consent, tagId, sortBy, sortDirection: sortDirection.toLocaleLowerCase() },
  });
}

export interface ContactInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  consentStatus?: string;
  consentSource?: string;
  consentAt?: string | null;
  metadata?: Record<string, unknown>;
  tags?: string[] | string;
}

export async function importContacts(env: Env, context: AuthContext, contacts: ContactInput[]): Promise<{ created: number; updated: number; rejected: number }> {
  requireRole(context, ['owner', 'admin', 'editor']);
  if (contacts.length > 1000) throw new HttpError(400, 'Import up to 1,000 contacts per request.');
  const tagNames = contacts.flatMap((contact) => normalizeTagNames(contact.tags));
  const tagIdsBySlug = await ensureTags(env, context.workspaceId, tagNames);
  let created = 0;
  let updated = 0;
  let rejected = 0;
  const statements: D1PreparedStatement[] = [];
  const contactTags: Array<{ contactId: string; tagIds: string[] }> = [];
  const pendingByHash = new Map<string, string>();

  for (const input of contacts) {
    const email = normalizeEmail(input.email ?? '');
    if (!isValidEmail(email)) {
      rejected += 1;
      continue;
    }
    const encrypted = await encryptEmail(env, email);
    let contactId = pendingByHash.get(encrypted.hash);
    let exists = contactId ? { id: contactId } : await env.DB.prepare('SELECT id FROM contacts WHERE workspace_id = ? AND email_hash = ?')
      .bind(context.workspaceId, encrypted.hash)
      .first<{ id: string }>();
    const now = nowIso();
    const consentStatus = ALLOWED_CONSENT.has(input.consentStatus ?? '') ? input.consentStatus! : 'unknown';
    if (exists) {
      contactId = exists.id;
      updated += 1;
      statements.push(env.DB.prepare(
        `UPDATE contacts SET email_ciphertext = ?, email_iv = ?, first_name = ?, last_name = ?, metadata_json = ?, consent_status = ?, consent_source = ?, consent_at = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).bind(
        encrypted.ciphertext,
        encrypted.iv,
        String(input.firstName ?? '').slice(0, 120) || null,
        String(input.lastName ?? '').slice(0, 120) || null,
        JSON.stringify(input.metadata ?? {}),
        consentStatus,
        String(input.consentSource ?? '').slice(0, 300) || null,
        input.consentAt ? new Date(input.consentAt).toISOString() : null,
        now,
        contactId,
        context.workspaceId,
      ));
    } else {
      contactId = randomId('con_');
      pendingByHash.set(encrypted.hash, contactId);
      created += 1;
      statements.push(env.DB.prepare(
        `INSERT INTO contacts (id, workspace_id, email_ciphertext, email_iv, email_hash, first_name, last_name, metadata_json, consent_status, consent_source, consent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        contactId,
        context.workspaceId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.hash,
        String(input.firstName ?? '').slice(0, 120) || null,
        String(input.lastName ?? '').slice(0, 120) || null,
        JSON.stringify(input.metadata ?? {}),
        consentStatus,
        String(input.consentSource ?? '').slice(0, 300) || null,
        input.consentAt ? new Date(input.consentAt).toISOString() : null,
        now,
        now,
      ));
    }
    if (input.tags !== undefined) {
      const ids = normalizeTagNames(input.tags).map((name) => tagIdsBySlug.get(tagSlug(name))).filter((id): id is string => Boolean(id));
      contactTags.push({ contactId, tagIds: [...new Set(ids)] });
    }
  }

  for (let index = 0; index < statements.length; index += 75) await env.DB.batch(statements.slice(index, index + 75));
  const tagStatements: D1PreparedStatement[] = [];
  for (const item of contactTags) {
    tagStatements.push(env.DB.prepare('DELETE FROM contact_tags WHERE contact_id = ?').bind(item.contactId));
    for (const tagId of item.tagIds) tagStatements.push(env.DB.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) VALUES (?, ?, ?)').bind(item.contactId, tagId, nowIso()));
  }
  for (let index = 0; index < tagStatements.length; index += 75) await env.DB.batch(tagStatements.slice(index, index + 75));
  return { created, updated, rejected };
}

/**
 * Erase a contact. Suppression records are keyed by email_hash and deliberately
 * survive deletion, so an unsubscribed or bounced address cannot be silently
 * re-mailed if the same person is imported again. This matches the privacy policy.
 */
export async function handleContactDelete(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  // D1 enforces ON DELETE CASCADE, so meta.changes also counts the contact's
  // cascaded send/engagement rows and cannot tell us whether a contact matched.
  // Check existence up front instead.
  const existing = await env.DB.prepare('SELECT 1 FROM contacts WHERE id = ? AND workspace_id = ?')
    .bind(id, context.workspaceId)
    .first();
  if (!existing) throw new HttpError(404, 'Contact not found.');
  await env.DB.prepare('DELETE FROM contacts WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
  await audit(env, request, context, 'contact.delete', 'contact', id);
  return json({ ok: true, deleted: 1 });
}

export async function handleContactsBulkDelete(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{ contactIds?: string[] }>(request);
  const ids = [...new Set((body.contactIds ?? []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 500);
  if (!ids.length) throw new HttpError(400, 'Select at least one contact to delete.');
  const placeholders = ids.map(() => '?').join(',');
  // Count first for the same cascade reason as above.
  const matched = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND id IN (${placeholders})`)
    .bind(context.workspaceId, ...ids)
    .first<{ count: number }>();
  const deleted = matched?.count ?? 0;
  if (deleted > 0) {
    await env.DB.prepare(`DELETE FROM contacts WHERE workspace_id = ? AND id IN (${placeholders})`)
      .bind(context.workspaceId, ...ids)
      .run();
  }
  await audit(env, request, context, 'contact.bulk_delete', undefined, undefined, { requested: ids.length, deleted });
  return json({ ok: true, deleted });
}

export async function handleTagsList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.created_at, COUNT(ct.contact_id) AS contact_count
     FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
     WHERE t.workspace_id = ? GROUP BY t.id ORDER BY t.name`,
  )
    .bind(context.workspaceId)
    .all<{ id: string; name: string; slug: string; created_at: string; contact_count: number }>();
  return json({ tags: rows.results });
}

export async function handleTagCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{ name?: string }>(request);
  const names = normalizeTagNames([body.name ?? '']);
  if (!names.length) throw new HttpError(400, 'Enter a tag name.');
  const map = await ensureTags(env, context.workspaceId, names);
  const id = map.get(tagSlug(names[0]!));
  await audit(env, request, context, 'tag.create', 'tag', id, { name: names[0] });
  return json({ id, name: names[0] }, 201);
}

export async function handleTagDelete(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const result = await env.DB.prepare('DELETE FROM tags WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, 'Tag not found.');
  await audit(env, request, context, 'tag.delete', 'tag', id);
  return json({ ok: true });
}

export async function handleContactTagsBulk(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{ contactIds?: string[]; addTagIds?: string[]; removeTagIds?: string[] }>(request);
  const contactIds = [...new Set((body.contactIds ?? []).map(String).filter(Boolean))].slice(0, 1000);
  const addTagIds = [...new Set((body.addTagIds ?? []).map(String).filter(Boolean))].slice(0, 50);
  const removeTagIds = [...new Set((body.removeTagIds ?? []).map(String).filter(Boolean))].slice(0, 50);
  if (!contactIds.length) throw new HttpError(400, 'Select at least one contact.');
  if (!addTagIds.length && !removeTagIds.length) throw new HttpError(400, 'Choose tags to add or remove.');

  const contactCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND id IN (${contactIds.map(() => '?').join(',')})`)
    .bind(context.workspaceId, ...contactIds).first<{ count: number }>();
  if ((contactCount?.count ?? 0) !== contactIds.length) throw new HttpError(400, 'One or more selected contacts are unavailable.');
  const allTagIds = [...new Set([...addTagIds, ...removeTagIds])];
  const tagCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM tags WHERE workspace_id = ? AND id IN (${allTagIds.map(() => '?').join(',')})`)
    .bind(context.workspaceId, ...allTagIds).first<{ count: number }>();
  if ((tagCount?.count ?? 0) !== allTagIds.length) throw new HttpError(400, 'One or more selected tags are unavailable.');

  const statements: D1PreparedStatement[] = [];
  const now = nowIso();
  for (const contactId of contactIds) {
    for (const tagId of addTagIds) statements.push(env.DB.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) VALUES (?, ?, ?)').bind(contactId, tagId, now));
    for (const tagId of removeTagIds) statements.push(env.DB.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?').bind(contactId, tagId));
  }
  for (let index = 0; index < statements.length; index += 75) await env.DB.batch(statements.slice(index, index + 75));
  await audit(env, request, context, 'contact.tags.bulk', 'contact', undefined, { contactCount: contactIds.length, addTagIds, removeTagIds });
  return json({ updated: contactIds.length });
}
