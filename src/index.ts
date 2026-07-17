import type { Env, SendJob } from './types';
import { authenticate } from './db';
import { deliverJob, finalizeCampaignIfComplete, recordDeadLetter } from './email';
import { handleApi } from './api/router';
import { handleClickRedirect, handleOpenPixel } from './api/tracking';
import { dispatchCampaign } from './api/campaigns';
import { HttpError, html, withSecurity } from './http';
import { escapeHtml, json, nowIso, randomId, verifyUnsubscribeToken } from './security';
import {
  dashboardPage,
  landingPage,
  loginPage,
  privacyPage,
  securityPage,
  termsPage,
  unsubscribePage,
} from './ui';

async function handleUnsubscribe(request: Request, env: Env, token: string): Promise<Response> {
  const payload = await verifyUnsubscribeToken(env, token);
  if (!payload) return html(unsubscribePage(env, token, 'invalid'), env, 400);
  const contact = await env.DB.prepare('SELECT email_hash FROM contacts WHERE id = ? AND workspace_id = ?')
    .bind(payload.contactId, payload.workspaceId)
    .first<{ email_hash: string }>();
  if (!contact) return html(unsubscribePage(env, token, 'invalid'), env, 404);
  if (request.method === 'POST') {
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(now, payload.contactId, payload.workspaceId),
      env.DB.prepare(
        `INSERT INTO suppressions (workspace_id, email_hash, reason, created_at) VALUES (?, ?, 'unsubscribe', ?)
         ON CONFLICT(workspace_id, email_hash) DO UPDATE SET reason = 'unsubscribe'`,
      ).bind(payload.workspaceId, contact.email_hash, now),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, workspace_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?, ?, 'contact.unsubscribe', 'contact', ?, '{}', ?)`,
      ).bind(randomId('aud_'), payload.workspaceId, payload.contactId, now),
    ]);
    return html(unsubscribePage(env, token, 'success'), env);
  }
  return html(unsubscribePage(env, token, 'confirm'), env);
}

async function fetchHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith('/api/')) return withSecurity(await handleApi(request, env, url), env);
    const openMatch = url.pathname.match(/^\/o\/([^/]+)$/);
    if (openMatch && request.method === 'GET') return handleOpenPixel(env, decodeURIComponent(openMatch[1]!));
    const clickMatch = url.pathname.match(/^\/c\/([^/]+)$/);
    if (clickMatch && request.method === 'GET') return handleClickRedirect(env, decodeURIComponent(clickMatch[1]!));
    const unsubscribeMatch = url.pathname.match(/^\/u\/([^/]+)$/);
    if (unsubscribeMatch && ['GET', 'POST'].includes(request.method)) return handleUnsubscribe(request, env, decodeURIComponent(unsubscribeMatch[1]!));
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

    if (url.pathname === '/') return html(landingPage(env), env);
    if (url.pathname === '/privacy') return html(privacyPage(env), env);
    if (url.pathname === '/terms') return html(termsPage(env), env);
    if (url.pathname === '/security') return html(securityPage(env), env);
    if (url.pathname === '/login') {
      const context = await authenticate(request, env);
      if (context) return Response.redirect(`${url.origin}/app`, 302);
      return html(loginPage(env), env);
    }
    if (url.pathname === '/app') {
      const context = await authenticate(request, env);
      if (!context) return Response.redirect(`${url.origin}/login`, 302);
      return html(dashboardPage(env), env);
    }

    const asset = await env.ASSETS.fetch(request);
    return withSecurity(asset, env);
  } catch (error) {
    if (error instanceof HttpError) {
      if (url.pathname.startsWith('/api/')) return withSecurity(json({ error: error.message }, error.status), env);
      return html(`<main class="auth-page"><section class="auth-card"><h1>${error.status}</h1><p>${escapeHtml(error.message)}</p><a class="button primary" href="/">Return home</a></section></main>`, env, error.status);
    }
    console.error('Unhandled request error', error);
    if (url.pathname.startsWith('/api/')) return withSecurity(json({ error: 'Unexpected server error.' }, 500), env);
    return html('<main class="auth-page"><section class="auth-card"><h1>Something went wrong</h1><p>Please try again later.</p></section></main>', env, 500);
  }
}

async function scheduledHandler(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil((async () => {
    await env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ? OR consumed_at IS NOT NULL').bind(nowIso()).run();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()).run();
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)).run();
    const due = await env.DB.prepare(
      "SELECT id, workspace_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 20",
    )
      .bind(nowIso())
      .all<{ id: string; workspace_id: string }>();
    for (const campaign of due.results) {
      try {
        await dispatchCampaign(env, campaign.id, campaign.workspace_id);
      } catch (error) {
        console.error('Scheduled campaign failed', campaign.id, error);
        await env.DB.prepare("UPDATE campaigns SET status = 'failed', updated_at = ? WHERE id = ?")
          .bind(nowIso(), campaign.id)
          .run();
      }
    }
  })());
}

const DEAD_LETTER_QUEUE = 'sakura-mail-dead-letter';

/** Messages that exhausted every retry: record the failure so it is visible instead of silently lost. */
async function deadLetterHandler(batch: MessageBatch<SendJob>, env: Env): Promise<void> {
  const campaigns = new Set<string>();
  for (const message of batch.messages) {
    campaigns.add(message.body.campaignId);
    try {
      await recordDeadLetter(env, message.body);
      message.ack();
    } catch (error) {
      console.error('Dead-letter recording failed', message.body, error);
      message.retry();
    }
  }
  for (const campaignId of campaigns) await finalizeCampaignIfComplete(env, campaignId);
}

async function queueHandler(batch: MessageBatch<SendJob>, env: Env): Promise<void> {
  if (batch.queue === DEAD_LETTER_QUEUE) return deadLetterHandler(batch, env);
  const campaigns = new Set<string>();
  for (const message of batch.messages) {
    campaigns.add(message.body.campaignId);
    try {
      await deliverJob(env, message.body);
      message.ack();
    } catch (error) {
      console.error('Delivery job failed', message.body, error);
      message.retry({ delaySeconds: 60 });
    }
  }
  for (const campaignId of campaigns) await finalizeCampaignIfComplete(env, campaignId);
}

export default {
  fetch: fetchHandler,
  scheduled: scheduledHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, SendJob>;
