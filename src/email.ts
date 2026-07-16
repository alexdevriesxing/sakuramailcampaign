import type { CampaignRow, ContactRow, Env, SendJob } from './types';
import { createUnsubscribeToken, decryptEmail, escapeHtml, nowIso, randomId } from './security';

function personalize(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => values[key] ?? '');
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function attachmentsForCampaign(env: Env, campaignId: string, workspaceId: string) {
  const rows = await env.DB.prepare(
    `SELECT f.r2_key, f.filename, f.content_type, f.size_bytes
     FROM campaign_attachments ca
     JOIN files f ON f.id = ca.file_id
     WHERE ca.campaign_id = ? AND f.workspace_id = ?`,
  )
    .bind(campaignId, workspaceId)
    .all<{ r2_key: string; filename: string; content_type: string; size_bytes: number }>();

  const attachments: Array<{ filename: string; contentType: string; content: ArrayBuffer }> = [];
  let total = 0;
  for (const row of rows.results) {
    total += row.size_bytes;
    if (total > 5 * 1024 * 1024) throw new Error('Attachments exceed Cloudflare Email Service 5 MiB message limit.');
    const object = await env.FILES.get(row.r2_key);
    if (!object) throw new Error(`Attachment ${row.filename} was not found.`);
    attachments.push({ filename: row.filename, contentType: row.content_type, content: await object.arrayBuffer() });
  }
  return attachments;
}

export async function deliverJob(env: Env, job: SendJob): Promise<void> {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(job.campaignId, job.workspaceId)
    .first<CampaignRow>();
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?')
    .bind(job.contactId, job.workspaceId)
    .first<ContactRow>();
  if (!campaign || !contact) return;

  const suppressed = await env.DB.prepare('SELECT 1 FROM suppressions WHERE workspace_id = ? AND email_hash = ?')
    .bind(job.workspaceId, contact.email_hash)
    .first();
  if (suppressed || contact.status !== 'active') {
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, error_code, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'failed', 'SUPPRESSED', 'Contact is suppressed or inactive', ?, ?)
         ON CONFLICT(campaign_id, contact_id) DO UPDATE SET status = 'failed', error_code = 'SUPPRESSED', error_message = 'Contact is suppressed or inactive', updated_at = excluded.updated_at`,
      ).bind(randomId('send_'), job.workspaceId, job.campaignId, job.contactId, now, now),
      env.DB.prepare(
        `UPDATE campaigns SET
          sent_count = (SELECT COUNT(*) FROM send_events WHERE campaign_id = ? AND status = 'accepted'),
          failed_count = (SELECT COUNT(*) FROM send_events WHERE campaign_id = ? AND status IN ('failed','bounced','complained')),
          updated_at = ? WHERE id = ?`,
      ).bind(job.campaignId, job.campaignId, now, job.campaignId),
    ]);
    return;
  }

  const workspace = await env.DB.prepare(
    'SELECT business_name, postal_address FROM workspaces WHERE id = ?',
  )
    .bind(job.workspaceId)
    .first<{ business_name: string | null; postal_address: string | null }>();
  if (!workspace?.business_name || !workspace.postal_address) throw new Error('Business identity and postal address are required.');

  const email = await decryptEmail(env, contact.email_ciphertext, contact.email_iv);
  const values = {
    email: escapeHtml(email),
    first_name: escapeHtml(contact.first_name ?? ''),
    last_name: escapeHtml(contact.last_name ?? ''),
  };
  const token = await createUnsubscribeToken(env, {
    workspaceId: job.workspaceId,
    contactId: job.contactId,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  });
  const unsubscribeUrl = `${env.APP_URL}/u/${encodeURIComponent(token)}`;
  const footer = `
    <div style="margin-top:32px;padding-top:18px;border-top:1px solid #eadde3;color:#725d67;font:12px/1.5 Arial,sans-serif">
      Sent by ${escapeHtml(workspace.business_name)} · ${escapeHtml(workspace.postal_address)}<br>
      <a href="${unsubscribeUrl}" style="color:#d82f72">Unsubscribe</a>
    </div>`;
  const html = `${personalize(campaign.html_body, values)}${footer}`;
  const textBase = personalize(campaign.text_body || stripTags(campaign.html_body), {
    email,
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
  });
  const text = `${textBase}\n\nSent by ${workspace.business_name} · ${workspace.postal_address}\nUnsubscribe: ${unsubscribeUrl}`;
  const attachments = await attachmentsForCampaign(env, campaign.id, job.workspaceId);

  try {
    const result = await env.EMAIL.send({
      to: email,
      from: { email: campaign.from_email, name: campaign.from_name },
      replyTo: campaign.reply_to ?? undefined,
      subject: personalize(campaign.subject, {
        email,
        first_name: contact.first_name ?? '',
        last_name: contact.last_name ?? '',
      }),
      html,
      text,
      attachments,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Sakura-Campaign': campaign.id,
      },
    });
    const messageId = result && 'messageId' in result ? result.messageId ?? null : null;
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, provider_message_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?)
         ON CONFLICT(campaign_id, contact_id) DO UPDATE SET status = 'accepted', provider_message_id = excluded.provider_message_id, updated_at = excluded.updated_at`,
      ).bind(randomId('send_'), job.workspaceId, job.campaignId, job.contactId, messageId, now, now),
      env.DB.prepare(
        `UPDATE campaigns SET
          sent_count = (SELECT COUNT(*) FROM send_events WHERE campaign_id = ? AND status = 'accepted'),
          failed_count = (SELECT COUNT(*) FROM send_events WHERE campaign_id = ? AND status IN ('failed','bounced','complained')),
          updated_at = ? WHERE id = ?`,
      ).bind(job.campaignId, job.campaignId, now, job.campaignId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery failure';
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, error_code, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 'DELIVERY_RETRY', ?, ?, ?)
         ON CONFLICT(campaign_id, contact_id) DO UPDATE SET status = 'queued', error_code = 'DELIVERY_RETRY', error_message = excluded.error_message, updated_at = excluded.updated_at`,
      ).bind(randomId('send_'), job.workspaceId, job.campaignId, job.contactId, message, now, now),
    ]);
    throw error;
  }
}

export async function finalizeCampaignIfComplete(env: Env, campaignId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT c.recipient_count, c.sent_count, c.failed_count,
      (SELECT COUNT(*) FROM send_events s WHERE s.campaign_id = c.id AND s.status = 'queued') AS queued_count
     FROM campaigns c WHERE c.id = ?`,
  )
    .bind(campaignId)
    .first<{ recipient_count: number; sent_count: number; failed_count: number; queued_count: number }>();
  if (!row) return;
  if (row.sent_count + row.failed_count >= row.recipient_count && row.queued_count === 0) {
    await env.DB.prepare("UPDATE campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), campaignId)
      .run();
  }
}
