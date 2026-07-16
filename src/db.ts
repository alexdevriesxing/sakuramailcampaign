import type { AuthContext, Env } from './types';
import { hmacHex, nowIso, parseCookies, requestIp, sha256Hex } from './security';

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const token = parseCookies(request).sakura_session;
  if (!token) return null;
  const tokenHash = await sha256Hex(`session:${token}:${env.AUTH_PEPPER}`);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, u.email, m.workspace_id, m.role, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = u.id
     WHERE s.token_hash = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'editor' THEN 3 ELSE 4 END
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      session_id: string;
      user_id: string;
      email: string;
      workspace_id: string;
      role: AuthContext['role'];
      expires_at: string;
    }>();

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  const now = nowIso();
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run();
  const adminEmails = env.ADMIN_EMAILS.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    workspaceId: row.workspace_id,
    role: row.role,
    isPlatformAdmin: adminEmails.includes(row.email.toLowerCase()),
  };
}

export async function audit(
  env: Env,
  request: Request,
  context: Partial<AuthContext>,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const ipHash = await hmacHex(env.AUTH_PEPPER, `ip:${requestIp(request)}`);
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, workspace_id, user_id, action, target_type, target_id, metadata_json, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      context.workspaceId ?? null,
      context.userId ?? null,
      action,
      targetType ?? null,
      targetId ?? null,
      JSON.stringify(metadata),
      ipHash,
      nowIso(),
    )
    .run();
}

export async function createSession(
  env: Env,
  userId: string,
  request: Request,
): Promise<{ token: string; sessionId: string }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256Hex(`session:${token}:${env.AUTH_PEPPER}`);
  const sessionId = crypto.randomUUID();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const ipHash = await hmacHex(env.AUTH_PEPPER, `ip:${requestIp(request)}`);
  const userAgent = (request.headers.get('User-Agent') ?? '').slice(0, 500);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, tokenHash, expiresAt, now, now, ipHash, userAgent)
    .run();
  return { token, sessionId };
}
