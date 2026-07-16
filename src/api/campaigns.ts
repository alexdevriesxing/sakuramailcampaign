import type { AuthContext, CampaignRow, Env } from '../types';
import { audit } from '../db';
import { isValidEmail, json, normalizeEmail, nowIso, randomId } from '../security';
import { HttpError, MAX_FILE_BYTES, readJson, requireRole, validSenderForEnvironment } from '../http';

export async function handleCampaignCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{
    name?: string;
    subject?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    htmlBody?: string;
    textBody?: string;
    scheduledAt?: string | null;
    attachmentIds?: string[];
  }>(request);
  const name = String(body.name ?? '').trim().slice(0, 120);
  const subject = String(body.subject ?? '').trim().slice(0, 998);
  const fromName = String(body.fromName ?? '').trim().slice(0, 100);
  const fromEmail = normalizeEmail(body.fromEmail ?? '');
  const replyTo = body.replyTo ? normalizeEmail(body.replyTo) : null;
  const htmlBody = String(body.htmlBody ?? '').trim();
  const textBody = String(body.textBody ?? '').trim();
  if (!name || !subject || !fromName || !isValidEmail(fromEmail) || !htmlBody) throw new HttpError(400, 'Complete the campaign name, subject, sender and HTML message.');
  if (!validSenderForEnvironment(fromEmail, env)) throw new HttpError(400, `Sender must use the configured ${env.FROM_EMAIL.split('@')[1]} domain.`);
  if (replyTo && !isValidEmail(replyTo)) throw new HttpError(400, 'Reply-to address is invalid.');
  if (htmlBody.length > 500_000 || textBody.length > 500_000) throw new HttpError(400, 'Message content is too large.');

  let scheduledAt: string | null = null;
  let status = 'draft';
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
    const files = await env.DB.prepare(
      `SELECT id, size_bytes FROM files WHERE workspace_id = ? AND id IN (${placeholders})`,
    )
      .bind(context.workspaceId, ...attachmentIds)
      .all<{ id: string; size_bytes: number }>();
    if (files.results.length !== attachmentIds.length) throw new HttpError(400, 'One or more attachments are unavailable.');
    attachmentTotal = files.results.reduce((sum, file) => sum + file.size_bytes, 0);
    if (attachmentTotal > MAX_FILE_BYTES) throw new HttpError(400, 'Combined attachments exceed the 5 MiB email limit.');
  }

  const id = randomId('cmp_');
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO campaigns (id, workspace_id, name, subject, from_name, from_email, reply_to, html_body, text_body, status, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, context.workspaceId, name, subject, fromName, fromEmail, replyTo, htmlBody, textBody, status, scheduledAt, now, now),
    ...attachmentIds.map((fileId) => env.DB.prepare('INSERT INTO campaign_attachments (campaign_id, file_id) VALUES (?, ?)').bind(id, fileId)),
  ];
  await env.DB.batch(statements);
  await audit(env, request, context, 'campaign.create', 'campaign', id, { scheduledAt, attachmentCount: attachmentIds.length, attachmentTotal });
  return json({ id, status }, 201);
}

async function getEligibleContactIds(env: Env, workspaceId: string): Promise<string[]> {
  const ids: string[] = [];
  let after = '';
  while (true) {
    const rows = await env.DB.prepare(
      `SELECT c.id FROM contacts c
       WHERE c.workspace_id = ? AND c.status = 'active' AND c.id > ?
       AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.workspace_id = c.workspace_id AND s.email_hash = c.email_hash)
       ORDER BY c.id LIMIT 500`,
    )
      .bind(workspaceId, after)
      .all<{ id: string }>();
    if (!rows.results.length) break;
    ids.push(...rows.results.map((row) => row.id));
    after = rows.results[rows.results.length - 1]!.id;
    if (rows.results.length < 500) break;
  }
  return ids;
}

export async function dispatchCampaign(env: Env, campaignId: string, workspaceId: string): Promise<number> {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, workspaceId)
    .first<CampaignRow>();
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  if (!['draft', 'scheduled', 'failed'].includes(campaign.status)) throw new HttpError(409, 'Campaign is already queued or sent.');
  const workspace = await env.DB.prepare(
    'SELECT business_name, postal_address, default_from_email FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ business_name: string | null; postal_address: string | null; default_from_email: string | null }>();
  if (!workspace?.business_name || !workspace.postal_address || !workspace.default_from_email) {
    throw new HttpError(400, 'Complete business identity, postal address and sender settings before sending.');
  }
  const contactIds = await getEligibleContactIds(env, workspaceId);
  if (!contactIds.length) throw new HttpError(400, 'There are no active, unsuppressed contacts.');

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
      await env.DB.batch(
        chunk.map((contactId) =>
          env.DB.prepare(
            `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'queued', ?, ?)
             ON CONFLICT(campaign_id, contact_id) DO UPDATE SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = excluded.updated_at`,
          ).bind(randomId('send_'), workspaceId, campaignId, contactId, now, now),
        ),
      );
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
