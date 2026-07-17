import type { Env } from '../types';
import { audit } from '../db';
import { checkOrigin, clearSessionCookie, enforceRateLimit, hmacHex, json } from '../security';
import { HttpError, readJson, requireAuth, requireRole, sanitizeFilename } from '../http';
import { handleAuthStart, handleAuthVerify, handleDashboard, handleMe } from './auth';
import {
  handleContactsList,
  handleContactTagsBulk,
  handleTagCreate,
  handleTagDelete,
  handleTagsList,
  importContacts,
  type ContactInput,
} from './contacts';
import { dispatchCampaign, handleCampaignCancel, handleCampaignCreate, handleCampaignDelete, handleCampaignUpdate } from './campaigns';
import { handleBillingCapture, handleBillingCreate, handleFilesUpload, handleSettingsUpdate } from './resources';
import { handleSenderCreate, handleSenderDelete, handleSendersList, handleSenderUpdate } from './senders';
import { countAudience, handleSegmentCreate, handleSegmentDelete, handleSegmentsList, handleSegmentUpdate, resolveAudienceRules, validateAudienceRules } from './audience';
import { handleCampaignRecipients, handlePlatformStats, handleWorkspaceReports } from './reports';
import { handleTemplateCreate, handleTemplateDelete, handleTemplateUpdate, handleTemplatesList } from './templates';
import { sendTestEmail } from '../email';

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!checkOrigin(request, env)) throw new HttpError(403, 'Origin validation failed.');
  const path = url.pathname;
  if (request.method === 'POST' && path === '/api/auth/start') return handleAuthStart(request, env);
  if (request.method === 'POST' && path === '/api/auth/verify') return handleAuthVerify(request, env);

  const context = await requireAuth(request, env);
  if (request.method === 'POST' && path === '/api/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(context.sessionId).run();
    await audit(env, request, context, 'auth.logout');
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', clearSessionCookie());
    return response;
  }
  if (request.method === 'GET' && path === '/api/me') return handleMe(request, env, context);
  if (request.method === 'GET' && path === '/api/dashboard') return handleDashboard(env, context);
  if (request.method === 'GET' && path === '/api/reports') return handleWorkspaceReports(env, context);
  const recipientsMatch = path.match(/^\/api\/reports\/campaigns\/([^/]+)\/recipients$/);
  if (recipientsMatch && request.method === 'GET') return handleCampaignRecipients(request, env, context, decodeURIComponent(recipientsMatch[1]!));

  if (path === '/api/templates' && request.method === 'GET') return handleTemplatesList(env, context);
  if (path === '/api/templates' && request.method === 'POST') return handleTemplateCreate(request, env, context);
  const templateMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch && request.method === 'PATCH') return handleTemplateUpdate(request, env, context, decodeURIComponent(templateMatch[1]!));
  if (templateMatch && request.method === 'DELETE') return handleTemplateDelete(request, env, context, decodeURIComponent(templateMatch[1]!));

  if (path === '/api/contacts' && request.method === 'GET') return handleContactsList(request, env, context);
  if (path === '/api/contacts' && request.method === 'POST') {
    const input = await readJson<ContactInput>(request);
    const result = await importContacts(env, context, [input]);
    if (!result.created && !result.updated) throw new HttpError(400, 'Contact email is invalid.');
    await audit(env, request, context, 'contact.add', 'contact', undefined, result);
    return json(result, 201);
  }
  if (path === '/api/contacts/import' && request.method === 'POST') {
    const body = await readJson<{ contacts?: ContactInput[] }>(request);
    const result = await importContacts(env, context, Array.isArray(body.contacts) ? body.contacts : []);
    await audit(env, request, context, 'contact.import', undefined, undefined, result);
    return json(result);
  }
  if (path === '/api/contacts/tags' && request.method === 'PATCH') return handleContactTagsBulk(request, env, context);

  if (path === '/api/tags' && request.method === 'GET') return handleTagsList(env, context);
  if (path === '/api/tags' && request.method === 'POST') return handleTagCreate(request, env, context);
  const tagMatch = path.match(/^\/api\/tags\/([^/]+)$/);
  if (tagMatch && request.method === 'DELETE') return handleTagDelete(request, env, context, decodeURIComponent(tagMatch[1]!));

  if (path === '/api/audience/count' && request.method === 'POST') {
    const body = await readJson<{ segmentId?: string | null; audienceRules?: unknown }>(request);
    const segmentId = String(body.segmentId ?? '').trim() || null;
    const rules = await resolveAudienceRules(env, context.workspaceId, segmentId, body.audienceRules);
    await validateAudienceRules(env, context.workspaceId, rules);
    return json({ count: await countAudience(env, context.workspaceId, rules) });
  }

  if (path === '/api/segments' && request.method === 'GET') return handleSegmentsList(env, context);
  if (path === '/api/segments' && request.method === 'POST') return handleSegmentCreate(request, env, context);
  const segmentMatch = path.match(/^\/api\/segments\/([^/]+)$/);
  if (segmentMatch && request.method === 'PATCH') return handleSegmentUpdate(request, env, context, decodeURIComponent(segmentMatch[1]!));
  if (segmentMatch && request.method === 'DELETE') return handleSegmentDelete(request, env, context, decodeURIComponent(segmentMatch[1]!));

  if (path === '/api/senders' && request.method === 'GET') return handleSendersList(env, context);
  if (path === '/api/senders' && request.method === 'POST') return handleSenderCreate(request, env, context);
  const senderMatch = path.match(/^\/api\/senders\/([^/]+)$/);
  if (senderMatch && request.method === 'PATCH') return handleSenderUpdate(request, env, context, decodeURIComponent(senderMatch[1]!));
  if (senderMatch && request.method === 'DELETE') return handleSenderDelete(request, env, context, decodeURIComponent(senderMatch[1]!));

  if (path === '/api/campaigns' && request.method === 'GET') {
    const campaigns = await env.DB.prepare(
      `SELECT c.id, c.name, c.subject, c.status, c.recipient_count, c.sent_count, c.failed_count, c.scheduled_at, c.sent_at, c.created_at,
        c.from_name, c.from_email, si.label AS sender_label, s.name AS segment_name
       FROM campaigns c
       LEFT JOIN sender_identities si ON si.id = c.sender_identity_id AND si.workspace_id = c.workspace_id
       LEFT JOIN segments s ON s.id = c.segment_id AND s.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? ORDER BY c.created_at DESC LIMIT 250`,
    )
      .bind(context.workspaceId)
      .all();
    return json({ campaigns: campaigns.results });
  }
  if (path === '/api/campaigns' && request.method === 'POST') return handleCampaignCreate(request, env, context);
  const campaignGetMatch = path.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignGetMatch && request.method === 'GET') {
    const campaign = await env.DB.prepare(
      `SELECT id, name, subject, preheader, html_body, text_body, from_name, reply_to, sender_identity_id,
        segment_id, audience_filter_json, track_opens, track_clicks, status
       FROM campaigns WHERE id = ? AND workspace_id = ?`,
    )
      .bind(decodeURIComponent(campaignGetMatch[1]!), context.workspaceId)
      .first();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');
    return json({ campaign });
  }
  if (campaignGetMatch && request.method === 'PATCH') return handleCampaignUpdate(request, env, context, decodeURIComponent(campaignGetMatch[1]!));
  if (campaignGetMatch && request.method === 'DELETE') return handleCampaignDelete(request, env, context, decodeURIComponent(campaignGetMatch[1]!));

  const campaignCancelMatch = path.match(/^\/api\/campaigns\/([^/]+)\/cancel$/);
  if (campaignCancelMatch && request.method === 'POST') return handleCampaignCancel(request, env, context, decodeURIComponent(campaignCancelMatch[1]!));

  const campaignTestMatch = path.match(/^\/api\/campaigns\/([^/]+)\/test$/);
  if (campaignTestMatch && request.method === 'POST') {
    requireRole(context, ['owner', 'admin', 'editor']);
    const rateKey = await hmacHex(env.AUTH_PEPPER, `test-send:${context.userId}`);
    if (!(await enforceRateLimit(env, rateKey, 20, 3600))) throw new HttpError(429, 'Too many test sends. Please wait before trying again.');
    const campaignId = decodeURIComponent(campaignTestMatch[1]!);
    const owns = await env.DB.prepare('SELECT 1 FROM campaigns WHERE id = ? AND workspace_id = ?').bind(campaignId, context.workspaceId).first();
    if (!owns) throw new HttpError(404, 'Campaign not found.');
    try {
      // Always send to the requester's own verified account email — never an
      // arbitrary address — so the test endpoint cannot be used as a relay.
      await sendTestEmail(env, campaignId, context.workspaceId, context.email);
    } catch (error) {
      throw new HttpError(503, error instanceof Error ? error.message : 'Test send failed.');
    }
    await audit(env, request, context, 'campaign.test', 'campaign', campaignId);
    return json({ ok: true, sentTo: context.email });
  }
  const campaignSendMatch = path.match(/^\/api\/campaigns\/([^/]+)\/send$/);
  if (campaignSendMatch && request.method === 'POST') {
    requireRole(context, ['owner', 'admin', 'editor']);
    const campaignId = decodeURIComponent(campaignSendMatch[1]!);
    const queued = await dispatchCampaign(env, campaignId, context.workspaceId);
    await audit(env, request, context, 'campaign.send', 'campaign', campaignId, { queued });
    return json({ queued });
  }

  if (path === '/api/files' && request.method === 'GET') {
    const files = await env.DB.prepare('SELECT id, filename, content_type, size_bytes, created_at FROM files WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 250')
      .bind(context.workspaceId)
      .all();
    return json({ files: files.results });
  }
  if (path === '/api/files' && request.method === 'POST') return handleFilesUpload(request, env, context);
  const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch && request.method === 'GET') {
    const id = decodeURIComponent(fileMatch[1]!);
    const record = await env.DB.prepare('SELECT r2_key, filename, content_type FROM files WHERE id = ? AND workspace_id = ?')
      .bind(id, context.workspaceId)
      .first<{ r2_key: string; filename: string; content_type: string }>();
    if (!record) throw new HttpError(404, 'File not found.');
    const object = await env.FILES.get(record.r2_key);
    if (!object) throw new HttpError(404, 'Stored file not found.');
    const headers = new Headers({
      'Content-Type': record.content_type,
      'Content-Disposition': `attachment; filename="${sanitizeFilename(record.filename).replaceAll('"', '')}"`,
      'Cache-Control': 'private, no-store',
    });
    return new Response(object.body, { headers });
  }
  if (fileMatch && request.method === 'DELETE') {
    requireRole(context, ['owner', 'admin', 'editor']);
    const id = decodeURIComponent(fileMatch[1]!);
    const record = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).first<{ r2_key: string }>();
    if (!record) throw new HttpError(404, 'File not found.');
    await env.FILES.delete(record.r2_key);
    await env.DB.prepare('DELETE FROM files WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
    await audit(env, request, context, 'file.delete', 'file', id);
    return json({ ok: true });
  }

  if (path === '/api/billing' && request.method === 'GET') {
    const workspace = await env.DB.prepare('SELECT credits FROM workspaces WHERE id = ?').bind(context.workspaceId).first<{ credits: number }>();
    const orders = await env.DB.prepare('SELECT quantity_thousands, amount_usd, status, created_at FROM billing_orders WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(context.workspaceId)
      .all();
    return json({ credits: workspace?.credits ?? 0, receiverEmail: env.PAYPAL_RECEIVER_EMAIL, orders: orders.results });
  }
  if (path === '/api/billing/orders' && request.method === 'POST') return handleBillingCreate(request, env, context);
  if (path === '/api/billing/capture' && request.method === 'POST') return handleBillingCapture(request, env, context);

  if (path === '/api/settings' && request.method === 'GET') {
    const workspace = await env.DB.prepare(
      `SELECT name, business_name, postal_address, default_from_name, default_from_email, reply_to_email
       FROM workspaces WHERE id = ?`,
    )
      .bind(context.workspaceId)
      .first<{ name: string; business_name: string | null; postal_address: string | null; default_from_name: string | null; default_from_email: string | null; reply_to_email: string | null }>();
    return json({
      workspaceName: workspace?.name ?? '',
      businessName: workspace?.business_name ?? '',
      postalAddress: workspace?.postal_address ?? '',
      defaultFromName: workspace?.default_from_name ?? '',
      defaultFromEmail: workspace?.default_from_email ?? '',
      replyToEmail: workspace?.reply_to_email ?? '',
    });
  }
  if (path === '/api/settings' && request.method === 'PATCH') return handleSettingsUpdate(request, env, context);

  if (path === '/api/admin/stats' && request.method === 'GET') return handlePlatformStats(env, context);

  throw new HttpError(404, 'API route not found.');
}
