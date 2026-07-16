import type { Env } from '../types';
import { type TrackingTokenPayload, createTrackingToken, nowIso, sha256Hex, verifyTrackingToken } from '../security';

// 1x1 transparent GIF, decoded once at module load.
const TRANSPARENT_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (char) => char.charCodeAt(0),
);

const HREF_LINK = /(<a\b[^>]*\shref=)(["'])(https?:\/\/[^"'\s]+)\2/gi;

function appOrigin(env: Env): string {
  return env.APP_URL.replace(/\/+$/, '');
}

/** Inject a hidden open-tracking pixel pointing back at this Worker. */
export function trackingPixel(env: Env, token: string): string {
  return `<img src="${appOrigin(env)}/o/${token}" alt="" width="1" height="1" style="display:none;width:1px;height:1px;border:0;max-height:1px;max-width:1px;overflow:hidden" />`;
}

/**
 * Rewrite absolute http(s) anchor links to click-tracking redirects. The target
 * URL is bound into the signed token, so the redirect endpoint cannot be abused
 * as an open redirect. Non-anchor URLs (images, CSS) are left untouched.
 */
export async function rewriteLinksForTracking(
  env: Env,
  html: string,
  base: { workspaceId: string; campaignId: string; contactId: string },
): Promise<string> {
  const origin = appOrigin(env);
  const urls = new Set<string>();
  for (const match of html.matchAll(HREF_LINK)) urls.add(match[3]!);
  if (!urls.size) return html;
  const tokenByUrl = new Map<string, string>();
  for (const url of urls) {
    tokenByUrl.set(url, await createTrackingToken(env, { ...base, url }));
  }
  return html.replace(HREF_LINK, (_full, prefix: string, quote: string, url: string) => {
    const token = tokenByUrl.get(url);
    return token ? `${prefix}${quote}${origin}/c/${token}${quote}` : `${prefix}${quote}${url}${quote}`;
  });
}

export async function recordOpen(env: Env, payload: TrackingTokenPayload): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO email_opens (workspace_id, campaign_id, contact_id, hits, first_at, last_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(campaign_id, contact_id) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at`,
  )
    .bind(payload.workspaceId, payload.campaignId, payload.contactId, now, now)
    .run();
}

export async function recordClick(env: Env, payload: TrackingTokenPayload, url: string): Promise<void> {
  const now = nowIso();
  const urlHash = await sha256Hex(url);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO email_clicks (workspace_id, campaign_id, contact_id, url_hash, url, hits, first_at, last_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(campaign_id, contact_id, url_hash) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at`,
    ).bind(payload.workspaceId, payload.campaignId, payload.contactId, urlHash, url, now, now),
    // A click proves engagement even if the open pixel was blocked, so ensure an open row exists.
    env.DB.prepare(
      `INSERT INTO email_opens (workspace_id, campaign_id, contact_id, hits, first_at, last_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(campaign_id, contact_id) DO UPDATE SET last_at = excluded.last_at`,
    ).bind(payload.workspaceId, payload.campaignId, payload.contactId, now, now),
  ]);
}

export async function handleOpenPixel(env: Env, token: string): Promise<Response> {
  const payload = await verifyTrackingToken(env, token);
  if (payload) {
    try {
      await recordOpen(env, payload);
    } catch (error) {
      console.error('Open tracking failed', error);
    }
  }
  // Always return the pixel, even for an invalid token, so validity is not leaked.
  return new Response(TRANSPARENT_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}

export async function handleClickRedirect(env: Env, token: string): Promise<Response> {
  const payload = await verifyTrackingToken(env, token);
  if (!payload?.url || !/^https?:\/\//i.test(payload.url)) return Response.redirect(appOrigin(env), 302);
  try {
    await recordClick(env, payload, payload.url);
  } catch (error) {
    console.error('Click tracking failed', error);
  }
  return Response.redirect(payload.url, 302);
}
