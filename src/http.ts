import type { AuthContext, Env } from './types';
import { authenticate } from './db';
import { normalizeEmail, securityHeaders } from './security';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function html(content: string, env: Env, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(env);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(content, { status, headers });
}

export function withSecurity(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  securityHeaders(env).forEach((value, key) => {
    if (!headers.has(key)) headers.set(key, value);
  });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > MAX_JSON_BYTES) throw new HttpError(413, 'Request is too large.');
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function requireRole(context: AuthContext, allowed: AuthContext['role'][]): void {
  if (!allowed.includes(context.role)) throw new HttpError(403, 'You do not have permission for this action.');
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const context = await authenticate(request, env);
  if (!context) throw new HttpError(401, 'Please sign in.');
  return context;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 180);
  return safe || 'attachment';
}

export function validSenderForEnvironment(email: string, env: Env): boolean {
  try {
    const senderDomain = normalizeEmail(email).split('@')[1];
    const configuredDomain = normalizeEmail(env.FROM_EMAIL).split('@')[1];
    return Boolean(senderDomain && configuredDomain && senderDomain === configuredDomain);
  } catch {
    return false;
  }
}
