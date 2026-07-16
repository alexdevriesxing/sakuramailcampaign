import type { AuthContext, Env } from '../types';
import { audit } from '../db';
import { HttpError, readJson, requireRole, validSenderForEnvironment } from '../http';
import { isValidEmail, json, normalizeEmail, nowIso, randomId } from '../security';

interface SenderRow {
  id: string;
  label: string;
  from_name: string;
  email: string;
  reply_to: string | null;
  status: 'active' | 'disabled';
  is_default: number;
  created_at: string;
  updated_at: string;
}

async function updateWorkspaceDefault(env: Env, workspaceId: string): Promise<void> {
  let sender = await env.DB.prepare(
    "SELECT id, from_name, email, reply_to FROM sender_identities WHERE workspace_id = ? AND is_default = 1 AND status = 'active' LIMIT 1",
  )
    .bind(workspaceId)
    .first<{ id: string; from_name: string; email: string; reply_to: string | null }>();
  if (!sender) {
    sender = await env.DB.prepare(
      "SELECT id, from_name, email, reply_to FROM sender_identities WHERE workspace_id = ? AND status = 'active' ORDER BY created_at LIMIT 1",
    )
      .bind(workspaceId)
      .first<{ id: string; from_name: string; email: string; reply_to: string | null }>();
    if (sender) {
      await env.DB.batch([
        env.DB.prepare('UPDATE sender_identities SET is_default = 0, updated_at = ? WHERE workspace_id = ?').bind(nowIso(), workspaceId),
        env.DB.prepare('UPDATE sender_identities SET is_default = 1, updated_at = ? WHERE id = ? AND workspace_id = ?').bind(nowIso(), sender.id, workspaceId),
      ]);
    }
  }
  await env.DB.prepare(
    'UPDATE workspaces SET default_from_name = ?, default_from_email = ?, reply_to_email = ?, updated_at = ? WHERE id = ?',
  )
    .bind(sender?.from_name ?? null, sender?.email ?? null, sender?.reply_to ?? null, nowIso(), workspaceId)
    .run();
}

function senderPayload(body: Record<string, unknown>, current?: SenderRow) {
  const label = body.label === undefined && current ? current.label : String(body.label ?? '').trim().slice(0, 80);
  const fromName = body.fromName === undefined && current ? current.from_name : String(body.fromName ?? '').trim().slice(0, 100);
  const email = body.email === undefined && current ? current.email : normalizeEmail(String(body.email ?? ''));
  const rawReply = body.replyTo === undefined && current ? current.reply_to : String(body.replyTo ?? '').trim();
  const replyTo = rawReply ? normalizeEmail(rawReply) : null;
  const status = body.status === undefined && current ? current.status : body.status === 'disabled' ? 'disabled' : 'active';
  const isDefault = body.isDefault === undefined && current ? Boolean(current.is_default) : Boolean(body.isDefault);
  return { label, fromName, email, replyTo, status, isDefault };
}

function validateSender(sender: ReturnType<typeof senderPayload>, env: Env): void {
  if (!sender.label || !sender.fromName || !isValidEmail(sender.email)) throw new HttpError(400, 'Complete the sender label, display name and email address.');
  if (!validSenderForEnvironment(sender.email, env)) throw new HttpError(400, `Sender must use the configured ${env.FROM_EMAIL.split('@')[1]} domain.`);
  if (sender.replyTo && !isValidEmail(sender.replyTo)) throw new HttpError(400, 'Reply-to email is invalid.');
  if (sender.isDefault && sender.status !== 'active') throw new HttpError(400, 'The default sender must be active.');
}

export async function handleSendersList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, label, from_name, email, reply_to, status, is_default, created_at, updated_at
     FROM sender_identities WHERE workspace_id = ? ORDER BY is_default DESC, created_at ASC`,
  )
    .bind(context.workspaceId)
    .all<SenderRow>();
  return json({
    senders: rows.results.map((row) => ({
      id: row.id,
      label: row.label,
      fromName: row.from_name,
      email: row.email,
      replyTo: row.reply_to ?? '',
      status: row.status,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

export async function handleSenderCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const body = await readJson<Record<string, unknown>>(request);
  const sender = senderPayload(body);
  validateSender(sender, env);
  const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM sender_identities WHERE workspace_id = ?').bind(context.workspaceId).first<{ count: number }>();
  const isDefault = sender.isDefault || (existing?.count ?? 0) === 0;
  const id = randomId('snd_');
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (isDefault) statements.push(env.DB.prepare('UPDATE sender_identities SET is_default = 0, updated_at = ? WHERE workspace_id = ?').bind(now, context.workspaceId));
  statements.push(
    env.DB.prepare(
      `INSERT INTO sender_identities (id, workspace_id, label, from_name, email, reply_to, status, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, context.workspaceId, sender.label, sender.fromName, sender.email, sender.replyTo, sender.status, isDefault ? 1 : 0, now, now),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new HttpError(409, 'That sender address already exists.');
    throw error;
  }
  await updateWorkspaceDefault(env, context.workspaceId);
  await audit(env, request, context, 'sender.create', 'sender_identity', id, { email: sender.email, isDefault });
  return json({ id, isDefault }, 201);
}

export async function handleSenderUpdate(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const current = await env.DB.prepare(
    'SELECT id, label, from_name, email, reply_to, status, is_default, created_at, updated_at FROM sender_identities WHERE id = ? AND workspace_id = ?',
  )
    .bind(id, context.workspaceId)
    .first<SenderRow>();
  if (!current) throw new HttpError(404, 'Sender identity not found.');
  const body = await readJson<Record<string, unknown>>(request);
  const sender = senderPayload(body, current);
  validateSender(sender, env);

  if (current.is_default && sender.status === 'disabled' && sender.isDefault) {
    throw new HttpError(400, 'Choose another default sender before disabling this one.');
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (sender.isDefault) statements.push(env.DB.prepare('UPDATE sender_identities SET is_default = 0, updated_at = ? WHERE workspace_id = ?').bind(now, context.workspaceId));
  statements.push(
    env.DB.prepare(
      `UPDATE sender_identities SET label = ?, from_name = ?, email = ?, reply_to = ?, status = ?, is_default = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(sender.label, sender.fromName, sender.email, sender.replyTo, sender.status, sender.isDefault ? 1 : 0, now, id, context.workspaceId),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new HttpError(409, 'That sender address already exists.');
    throw error;
  }
  await updateWorkspaceDefault(env, context.workspaceId);
  await audit(env, request, context, 'sender.update', 'sender_identity', id, { email: sender.email, isDefault: sender.isDefault, status: sender.status });
  return json({ ok: true });
}

export async function handleSenderDelete(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const sender = await env.DB.prepare('SELECT is_default FROM sender_identities WHERE id = ? AND workspace_id = ?')
    .bind(id, context.workspaceId)
    .first<{ is_default: number }>();
  if (!sender) throw new HttpError(404, 'Sender identity not found.');
  await env.DB.prepare('DELETE FROM sender_identities WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
  await updateWorkspaceDefault(env, context.workspaceId);
  await audit(env, request, context, 'sender.delete', 'sender_identity', id, { wasDefault: Boolean(sender.is_default) });
  return json({ ok: true });
}
