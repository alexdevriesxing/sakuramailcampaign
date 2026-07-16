import type { Env } from '../types';
import { escapeHtml } from '../security';

export function page(title: string, body: string, env: Env, options: { app?: boolean; description?: string } = {}): string {
  const description = options.description ?? 'Affordable, privacy-first email campaigns powered by Cloudflare.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#ec4882">
  <title>${escapeHtml(title)} · ${escapeHtml(env.APP_NAME)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="${options.app ? 'app-body' : ''}">
${body}
<script>window.SAKURA_CONFIG=${JSON.stringify({
    appName: env.APP_NAME,
    appUrl: env.APP_URL,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    paypalClientId: env.PAYPAL_CLIENT_ID,
    paypalMode: env.PAYPAL_MODE,
    pricePerThousand: env.PRICE_PER_1000_USD,
    minimumThousands: env.MIN_PURCHASE_THOUSANDS,
  }).replaceAll('<', '\\u003c')};</script>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}

export const logo = `<a class="brand" href="/" aria-label="Sakura Mail home"><img src="/logo.svg" alt="Sakura Mail"><span>Sakura Mail</span></a>`;
