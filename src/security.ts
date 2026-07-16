import type { Env } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix = ''): string {
  return prefix + crypto.randomUUID().replaceAll('-', '');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const input = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const bytes = base64UrlDecode(env.DATA_ENCRYPTION_KEY.replaceAll('+', '-').replaceAll('/', '_'));
  if (bytes.byteLength !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptEmail(env: Env, email: string): Promise<{ ciphertext: string; iv: string; hash: string }> {
  const normalized = normalizeEmail(email);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(normalized));
  return {
    ciphertext: base64UrlEncode(new Uint8Array(encrypted)),
    iv: base64UrlEncode(iv),
    hash: await hmacHex(env.AUTH_PEPPER, `contact:${normalized}`),
  };
}

export async function decryptEmail(env: Env, ciphertext: string, iv: string): Promise<string> {
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(iv) },
    key,
    base64UrlDecode(ciphertext),
  );
  return decoder.decode(decrypted);
}

export async function createUnsubscribeToken(
  env: Env,
  payload: { workspaceId: string; contactId: string; expiresAt: number },
): Promise<string> {
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacBase64Url(env.AUTH_PEPPER, `unsubscribe:${encoded}`);
  return `${encoded}.${signature}`;
}

export async function verifyUnsubscribeToken(
  env: Env,
  token: string,
): Promise<{ workspaceId: string; contactId: string; expiresAt: number } | null> {
  const [encoded, provided] = token.split('.');
  if (!encoded || !provided) return null;
  const expected = await hmacBase64Url(env.AUTH_PEPPER, `unsubscribe:${encoded}`);
  if (!constantTimeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(encoded))) as {
      workspaceId: string;
      contactId: string;
      expiresAt: number;
    };
    if (!payload.workspaceId || !payload.contactId || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? '';
  const values: Record<string, string> = {};
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    values[item.slice(0, separator).trim()] = decodeURIComponent(item.slice(separator + 1).trim());
  }
  return values;
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  return `sakura_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return 'sakura_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

export function requestIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export function checkOrigin(request: Request, env: Env): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    const requestOrigin = new URL(origin).origin;
    // Same-origin is the authoritative CSRF check: the browser sets Origin to the
    // true initiating origin and it cannot be forged cross-site, so a request whose
    // Origin equals the worker's own origin is always first-party. Accepting it lets
    // the app run on workers.dev and any attached custom domain without reconfiguration.
    if (requestOrigin === new URL(request.url).origin) return true;
    if (requestOrigin === new URL(env.APP_URL).origin) return true;
    return origin === 'http://localhost:8787';
  } catch {
    return false;
  }
}

export async function validateTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export async function enforceRateLimit(
  env: Env,
  key: string,
  maximumHits: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const expiresAt = windowStart + windowSeconds;
  const existing = await env.DB.prepare('SELECT window_start, hits FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ window_start: number; hits: number }>();

  if (!existing || existing.window_start !== windowStart) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, hits, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, hits = 1, expires_at = excluded.expires_at',
    )
      .bind(key, windowStart, expiresAt)
      .run();
    return true;
  }

  if (existing.hits >= maximumHits) return false;
  await env.DB.prepare('UPDATE rate_limits SET hits = hits + 1 WHERE key = ?').bind(key).run();
  return true;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function securityHeaders(env: Env): Headers {
  const headers = new Headers({
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com")',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com https://www.paypal.com https://www.sandbox.paypal.com",
      "frame-src https://challenges.cloudflare.com https://www.paypal.com https://www.sandbox.paypal.com",
      "connect-src 'self' https://challenges.cloudflare.com https://www.paypal.com https://www.sandbox.paypal.com",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  });
  if (env.APP_URL.startsWith('http://localhost')) headers.delete('Strict-Transport-Security');
  return headers;
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}
