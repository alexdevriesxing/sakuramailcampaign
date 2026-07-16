import type { AuthContext, Env } from '../types';
import { audit, createSession } from '../db';
import {
  enforceRateLimit,
  escapeHtml,
  hmacHex,
  isValidEmail,
  json,
  normalizeEmail,
  nowIso,
  randomId,
  requestIp,
  sessionCookie,
  sha256Hex,
  validateTurnstile,
} from '../security';
import { HttpError, readJson } from '../http';

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: string; turnstileToken?: string }>(request);
  const email = normalizeEmail(body.email ?? '');
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  const ip = requestIp(request);
  const ipKey = await hmacHex(env.AUTH_PEPPER, `auth-start:${ip}`);
  const emailKey = await hmacHex(env.AUTH_PEPPER, `auth-start-email:${email}`);
  const [ipAllowed, emailAllowed] = await Promise.all([
    enforceRateLimit(env, ipKey, 10, 15 * 60),
    enforceRateLimit(env, emailKey, 5, 15 * 60),
  ]);
  if (!ipAllowed || !emailAllowed) throw new HttpError(429, 'Too many attempts. Please wait and try again.');
  if (!(await validateTurnstile(env, body.turnstileToken ?? '', ip))) {
    throw new HttpError(400, 'Human verification failed. Please retry.');
  }

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
  const id = randomId('code_');
  const codeHash = await sha256Hex(`login:${email}:${code}:${env.AUTH_PEPPER}`);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, email, codeHash, expiresAt, now)
    .run();

  try {
    await env.EMAIL.send({
      to: email,
      from: { email: env.FROM_EMAIL, name: env.FROM_NAME },
      subject: `${code} is your ${env.APP_NAME} sign-in code`,
      html: `<div style="max-width:560px;margin:auto;font:16px/1.5 Arial,sans-serif;color:#261a20"><img src="${escapeHtml(env.APP_URL)}/logo.svg" width="90" alt="${escapeHtml(env.APP_NAME)}"><h1 style="font-size:28px">Your sign-in code</h1><p>Enter this code to continue. It expires in 10 minutes and can be used once.</p><div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#ec4882;padding:18px 0">${code}</div><p style="color:#735f68;font-size:13px">If you did not request this, you can ignore the message.</p></div>`,
      text: `Your ${env.APP_NAME} sign-in code is ${code}. It expires in 10 minutes.`,
    });
  } catch {
    await env.DB.prepare('DELETE FROM login_codes WHERE id = ?').bind(id).run();
    throw new HttpError(503, 'We could not send the verification email. Check the Email Service configuration.');
  }
  return json({ ok: true });
}

export async function handleAuthVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: string; code?: string }>(request);
  const email = normalizeEmail(body.email ?? '');
  const code = String(body.code ?? '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the email and six-digit code.');
  const key = await hmacHex(env.AUTH_PEPPER, `auth-verify:${requestIp(request)}:${email}`);
  if (!(await enforceRateLimit(env, key, 12, 15 * 60))) throw new HttpError(429, 'Too many attempts. Please wait.');

  const record = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, attempts FROM login_codes
     WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string; code_hash: string; expires_at: string; attempts: number }>();
  if (!record || new Date(record.expires_at).getTime() <= Date.now() || record.attempts >= 5) {
    throw new HttpError(400, 'That code is invalid or expired. Request a new one.');
  }
  const providedHash = await sha256Hex(`login:${email}:${code}:${env.AUTH_PEPPER}`);
  if (providedHash !== record.code_hash) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(record.id).run();
    throw new HttpError(400, 'That code is invalid or expired.');
  }

  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) {
    const userId = randomId('usr_');
    const workspaceId = randomId('ws_');
    const senderId = randomId('snd_');
    const workspaceName = email.split('@')[0] ? `${email.split('@')[0]}'s workspace` : 'My workspace';
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)').bind(userId, email, now, now),
      env.DB.prepare(
        `INSERT INTO workspaces (id, name, owner_user_id, default_from_name, default_from_email, reply_to_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(workspaceId, workspaceName, userId, env.FROM_NAME, env.FROM_EMAIL, email, now, now),
      env.DB.prepare('INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, ?, ?)').bind(userId, workspaceId, 'owner', now),
      env.DB.prepare(
        `INSERT INTO sender_identities (id, workspace_id, label, from_name, email, reply_to, status, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      ).bind(senderId, workspaceId, 'Default sender', env.FROM_NAME, env.FROM_EMAIL, email, now, now),
    ]);
    user = { id: userId };
  } else {
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  }
  await env.DB.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').bind(nowIso(), record.id).run();
  const session = await createSession(env, user.id, request);
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', sessionCookie(session.token));
  await audit(env, request, { userId: user.id }, 'auth.login');
  return response;
}

export async function handleMe(request: Request, env: Env, context: AuthContext): Promise<Response> {
  const workspace = await env.DB.prepare('SELECT name, credits FROM workspaces WHERE id = ?')
    .bind(context.workspaceId)
    .first<{ name: string; credits: number }>();
  return json({
    email: context.email,
    role: context.role,
    isPlatformAdmin: context.isPlatformAdmin,
    workspace: { id: context.workspaceId, name: workspace?.name ?? '', credits: workspace?.credits ?? 0 },
  });
}

export async function handleDashboard(env: Env, context: AuthContext): Promise<Response> {
  const [workspace, activeSender, activeContacts, suppressedContacts, sendTotals, scheduledCampaigns, campaigns] = await Promise.all([
    env.DB.prepare('SELECT credits, business_name, postal_address FROM workspaces WHERE id = ?').bind(context.workspaceId).first<{ credits: number; business_name: string | null; postal_address: string | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM sender_identities WHERE workspace_id = ? AND status = 'active'").bind(context.workspaceId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND status = 'active'").bind(context.workspaceId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND status != 'active'").bind(context.workspaceId).first<{ count: number }>(),
    env.DB.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status IN ('failed', 'bounced', 'complained') THEN 1 ELSE 0 END), 0) AS failed
       FROM send_events WHERE workspace_id = ?`,
    ).bind(context.workspaceId).first<{ accepted: number; failed: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE workspace_id = ? AND status = 'scheduled'").bind(context.workspaceId).first<{ count: number }>(),
    env.DB.prepare('SELECT id, name, subject, status, recipient_count, scheduled_at, sent_at FROM campaigns WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 8').bind(context.workspaceId).all(),
  ]);
  const acceptedSends = Number(sendTotals?.accepted ?? 0);
  const failedSends = Number(sendTotals?.failed ?? 0);
  const attempted = acceptedSends + failedSends;
  return json({
    credits: workspace?.credits ?? 0,
    activeContacts: activeContacts?.count ?? 0,
    suppressedContacts: suppressedContacts?.count ?? 0,
    acceptedSends,
    failedSends,
    deliveryRate: attempted > 0 ? acceptedSends / attempted : null,
    scheduledCampaigns: scheduledCampaigns?.count ?? 0,
    settingsComplete: Boolean(workspace?.business_name && workspace.postal_address && (activeSender?.count ?? 0) > 0),
    recentCampaigns: campaigns.results,
  });
}
