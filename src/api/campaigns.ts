import type { AuthContext, CampaignRow, Env } from '../types';
import { audit } from '../db';
import { isValidEmail, json, normalizeEmail, nowIso, randomId } from '../security';
import { HttpError, MAX_FILE_BYTES, readJson, requireRole, validSenderForEnvironment } from '../http';
import { type AudienceRules, countAudience, getEligibleContactIds, resolveAudienceRules, sanitizeAudienceRules, validateAudienceRules } from './audience';

/** Statuses a campaign can still be changed or removed in. Anything sending or sent is frozen. */
const MUTABLE_STATUSES = ['draft', 'scheduled', 'failed'];

interface CampaignInput {
  name?: string;
  subject?: string;
  senderId?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  htmlBody?: string;
  textBody?: string;
  scheduledAt?: string | null;
  attachmentIds?: string[];
  segmentId?: string | null;
  audienceRules?: unknown;
  trackOpens?: boolean;
  trackClicks?: boolean;
  preheader?: string;
}

interface ValidatedCampaign {
  name: string;
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  senderIdentityId: string;
  segmentId: string | null;
  audienceRules: AudienceRules;
  estimatedRecipients: number;
  scheduledAt: string | null;
  status: 'draft' | 'scheduled';
  attachmentIds: string[];
  trackOpens: number;
  trackClicks: number;
}

/** Shared validation for creating and editing a campaign, so both paths enforce identical rules. */
async function validateCampaignInput(env: Env, context: AuthContext, body: CampaignInput): Promise<ValidatedCampaign> {
  const trackOpens = body.trackOpens === true ? 1 : 0;
  const trackClicks = body.trackClicks === true ? 1 : 0;
  const name = String(body.name ?? '').trim().slice(0, 120);
  const subject = String(body.subject ?? '').trim().slice(0, 998);
  const preheader = String(body.preheader ?? '').trim().slice(0, 255);
  const htmlBody = String(body.htmlBody ?? '').trim();
  const textBody = String(body.textBody ?? '').trim();
  if (!name || !subject || !htmlBody) throw new HttpError(400, 'Complete the campaign name, subject and HTML message.');

  const senderId = String(body.senderId ?? '').trim();
  const requestedFromEmail = body.fromEmail ? normalizeEmail(body.fromEmail) : '';
  const sender = senderId
    ? await env.DB.prepare(
      "SELECT id, from_name, email, reply_to FROM sender_identities WHERE id = ? AND workspace_id = ? AND status = 'active'",
    ).bind(senderId, context.workspaceId).first<{ id: string; from_name: string; email: string; reply_to: string | null }>()
    : await env.DB.prepare(
      `SELECT id, from_name, email, reply_to FROM sender_identities
       WHERE workspace_id = ? AND status = 'active' AND (? = '' OR email = ?)
       ORDER BY CASE WHEN is_default = 1 THEN 0 ELSE 1 END, created_at LIMIT 1`,
    ).bind(context.workspaceId, requestedFromEmail, requestedFromEmail).first<{ id: string; from_name: string; email: string; reply_to: string | null }>();
  if (!sender) throw new HttpError(400, 'Choose an active sender identity in Settings.');
  if (!validSenderForEnvironment(sender.email, env)) throw new HttpError(400, `Sender must use the configured ${env.FROM_EMAIL.split('@')[1]} domain.`);

  const fromName = String(body.fromName ?? sender.from_name).trim().slice(0, 100) || sender.from_name;
  const fromEmail = normalizeEmail(sender.email);
  const replyTo = body.replyTo === undefined || body.replyTo === '' ? sender.reply_to : normalizeEmail(body.replyTo);
  if (!fromName || !isValidEmail(fromEmail)) throw new HttpError(400, 'The selected sender identity is incomplete.');
  if (replyTo && !isValidEmail(replyTo)) throw new HttpError(400, 'Reply-to address is invalid.');
  if (htmlBody.length > 500_000 || textBody.length > 500_000) throw new HttpError(400, 'Message content is too large.');

  const segmentId = String(body.segmentId ?? '').trim() || null;
  const audienceRules = await resolveAudienceRules(env, context.workspaceId, segmentId, body.audienceRules);
  await validateAudienceRules(env, context.workspaceId, audienceRules);
  const estimatedRecipients = await countAudience(env, context.workspaceId, audienceRules);

  let scheduledAt: string | null = null;
  let status: 'draft' | 'scheduled' = 'draft';
  if (body.scheduledAt) {
    const date = new Date(body.scheduledAt);
    if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Schedule time is invalid.');
    if (date.getTime() <= Date.now() + 60_000) throw new HttpError(400, 'Schedule at least one minute in the future, or send manually.');
    scheduledAt = date.toISOString();
    status = 'scheduled';
  }

  const attachmentIds = [...new Set((body.attachmentIds ?? []).filter(Boolean))];
  if (attachmentIds.length > 32) throw new HttpError(400, 'A campaign can have at most 32 attachments.');
  let attachmentTotal = 0;
  if (attachmentIds.length) {
    const placeholders = attachmentIds.map(() => '?').join(',');
    const files = await env.DB.prepare(`SELECT id, size_bytes FROM files WHERE workspace_id = ? AND id IN (${placeholders})`)
      .bind(context.workspaceId, ...attachmentIds)
      .all<{ id: string; size_bytes: number }>();
    if (files.results.length !== attachmentIds.length) throw new HttpError(400, 'One or more attachments are unavailable.');
    attachmentTotal = files.results.reduce((sum, file) => sum + file.size_bytes, 0);
    if (attachmentTotal > MAX_FILE_BYTES) throw new HttpError(400, 'Combined attachments exceed the 5 MiB email limit.');
  }

  return {
    name,
    subject,
    preheader,
    htmlBody,
    textBody,
    fromName,
    fromEmail,
    replyTo,
    senderIdentityId: sender.id,
    segmentId,
    audienceRules,
    estimatedRecipients,
    scheduledAt,
    status,
    attachmentIds,
    trackOpens,
    trackClicks,
  };
}

export async function handleCampaignCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const input = await validateCampaignInput(env, context, await readJson<CampaignInput>(request));
  const id = randomId('cmp_');
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaigns (
        id, workspace_id, name, subject, from_name, from_email, reply_to, html_body, text_body, preheader, status, scheduled_at,
        sender_identity_id, segment_id, audience_filter_json, track_opens, track_clicks, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      context.workspaceId,
      input.name,
      input.subject,
      input.fromName,
      input.fromEmail,
      input.replyTo,
      input.htmlBody,
      input.textBody,
      input.preheader,
      input.status,
      input.scheduledAt,
      input.senderIdentityId,
      input.segmentId,
      JSON.stringify(input.audienceRules),
      input.trackOpens,
      input.trackClicks,
      now,
      now,
    ),
    ...input.attachmentIds.map((fileId) => env.DB.prepare('INSERT INTO campaign_attachments (campaign_id, file_id) VALUES (?, ?)').bind(id, fileId)),
  ]);
  await audit(env, request, context, 'campaign.create', 'campaign', id, {
    scheduledAt: input.scheduledAt,
    senderId: input.senderIdentityId,
    segmentId: input.segmentId,
    estimatedRecipients: input.estimatedRecipients,
    attachmentCount: input.attachmentIds.length,
  });
  return json({ id, status: input.status, estimatedRecipients: input.estimatedRecipients }, 201);
}

export async function handleCampaignUpdate(request: Request, env: Env, context: AuthContext, campaignId: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const current = await env.DB.prepare('SELECT status FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, context.workspaceId)
    .first<{ status: string }>();
  if (!current) throw new HttpError(404, 'Campaign not found.');
  if (!MUTABLE_STATUSES.includes(current.status)) {
    throw new HttpError(409, 'This campaign is already sending or sent, so it can no longer be edited. Duplicate it instead.');
  }
  const input = await validateCampaignInput(env, context, await readJson<CampaignInput>(request));
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaigns SET name = ?, subject = ?, from_name = ?, from_email = ?, reply_to = ?, html_body = ?, text_body = ?,
        preheader = ?, status = ?, scheduled_at = ?, sender_identity_id = ?, segment_id = ?, audience_filter_json = ?,
        track_opens = ?, track_clicks = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(
      input.name,
      input.subject,
      input.fromName,
      input.fromEmail,
      input.replyTo,
      input.htmlBody,
      input.textBody,
      input.preheader,
      input.status,
      input.scheduledAt,
      input.senderIdentityId,
      input.segmentId,
      JSON.stringify(input.audienceRules),
      input.trackOpens,
      input.trackClicks,
      now,
      campaignId,
      context.workspaceId,
    ),
    env.DB.prepare('DELETE FROM campaign_attachments WHERE campaign_id = ?').bind(campaignId),
    ...input.attachmentIds.map((fileId) => env.DB.prepare('INSERT INTO campaign_attachments (campaign_id, file_id) VALUES (?, ?)').bind(campaignId, fileId)),
  ]);
  await audit(env, request, context, 'campaign.update', 'campaign', campaignId, {
    scheduledAt: input.scheduledAt,
    estimatedRecipients: input.estimatedRecipients,
  });
  return json({ ok: true, status: input.status, estimatedRecipients: input.estimatedRecipients });
}

export async function handleCampaignDelete(request: Request, env: Env, context: AuthContext, campaignId: string): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const current = await env.DB.prepare('SELECT status FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, context.workspaceId)
    .first<{ status: string }>();
  if (!current) throw new HttpError(404, 'Campaign not found.');
  // Sent campaigns are retained: deleting one would cascade away its send history,
  // engagement records and the audit trail behind your reports.
  if (!MUTABLE_STATUSES.includes(current.status)) {
    throw new HttpError(409, 'Sent campaigns are kept so your reporting and audit history stay intact.');
  }
  await env.DB.prepare('DELETE FROM campaigns WHERE id = ? AND workspace_id = ?').bind(campaignId, context.workspaceId).run();
  await audit(env, request, context, 'campaign.delete', 'campaign', campaignId, { status: current.status });
  return json({ ok: true });
}

export async function handleCampaignCancel(request: Request, env: Env, context: AuthContext, campaignId: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const current = await env.DB.prepare('SELECT status FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, context.workspaceId)
    .first<{ status: string }>();
  if (!current) throw new HttpError(404, 'Campaign not found.');
  if (current.status !== 'scheduled') {
    throw new HttpError(409, 'Only a scheduled campaign can be cancelled. Once sending starts, messages are already queued for delivery.');
  }
  // Guard against cancelling at the same moment the cron picks it up.
  const result = await env.DB.prepare(
    "UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'scheduled'",
  )
    .bind(nowIso(), campaignId, context.workspaceId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(409, 'This campaign already started sending.');
  await audit(env, request, context, 'campaign.cancel', 'campaign', campaignId);
  return json({ ok: true, status: 'draft' });
}

export async function dispatchCampaign(env: Env, campaignId: string, workspaceId: string): Promise<number> {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, workspaceId)
    .first<CampaignRow>();
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  if (!['draft', 'scheduled', 'failed'].includes(campaign.status)) throw new HttpError(409, 'Campaign is already queued or sent.');
  const workspace = await env.DB.prepare('SELECT business_name, postal_address FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first<{ business_name: string | null; postal_address: string | null }>();
  if (!workspace?.business_name || !workspace.postal_address) {
    throw new HttpError(400, 'Complete the business identity and postal address before sending.');
  }
  if (campaign.sender_identity_id) {
    const sender = await env.DB.prepare(
      "SELECT email FROM sender_identities WHERE id = ? AND workspace_id = ? AND status = 'active'",
    ).bind(campaign.sender_identity_id, workspaceId).first<{ email: string }>();
    if (!sender || normalizeEmail(sender.email) !== normalizeEmail(campaign.from_email)) {
      throw new HttpError(400, 'The campaign sender is disabled, deleted or changed. Choose an active sender and create a new campaign.');
    }
  } else if (!validSenderForEnvironment(campaign.from_email, env)) {
    throw new HttpError(400, 'The campaign sender is not authorized for this environment.');
  }

  const audienceRules = sanitizeAudienceRules(JSON.parse(campaign.audience_filter_json || '{}'));
  await validateAudienceRules(env, workspaceId, audienceRules);
  const contactIds = await getEligibleContactIds(env, workspaceId, audienceRules);
  if (!contactIds.length) throw new HttpError(400, 'There are no active, unsuppressed contacts in this campaign audience.');

  const reserve = await env.DB.prepare('UPDATE workspaces SET credits = credits - ?, updated_at = ? WHERE id = ? AND credits >= ?')
    .bind(contactIds.length, nowIso(), workspaceId, contactIds.length)
    .run();
  if ((reserve.meta.changes ?? 0) !== 1) throw new HttpError(402, `You need ${contactIds.length.toLocaleString()} credits for this campaign.`);

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE campaigns SET status = 'queueing', recipient_count = ?, sent_count = 0, failed_count = 0, updated_at = ? WHERE id = ?`,
  )
    .bind(contactIds.length, now, campaignId)
    .run();

  let queued = 0;
  try {
    for (let index = 0; index < contactIds.length; index += 100) {
      const chunk = contactIds.slice(index, index + 100);
      await env.DB.batch(chunk.map((contactId) => env.DB.prepare(
        `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)
         ON CONFLICT(campaign_id, contact_id) DO UPDATE SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = excluded.updated_at`,
      ).bind(randomId('send_'), workspaceId, campaignId, contactId, now, now)));
      await env.EMAIL_QUEUE.sendBatch(chunk.map((contactId) => ({ body: { campaignId, contactId, workspaceId } })));
      queued += chunk.length;
    }
    await env.DB.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ?").bind(nowIso(), campaignId).run();
    return queued;
  } catch (error) {
    const refund = contactIds.length - queued;
    if (refund > 0) await env.DB.prepare('UPDATE workspaces SET credits = credits + ?, updated_at = ? WHERE id = ?').bind(refund, nowIso(), workspaceId).run();
    await env.DB.prepare("UPDATE campaigns SET status = 'failed', recipient_count = ?, updated_at = ? WHERE id = ?")
      .bind(queued, nowIso(), campaignId)
      .run();
    throw error;
  }
}
