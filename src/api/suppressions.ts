import type { AuthContext, Env } from '../types';
import { audit } from '../db';
import { HttpError, maskEmail, readJson, requireRole } from '../http';
import { decryptEmail, hmacHex, isValidEmail, json, normalizeEmail, nowIso } from '../security';

/**
 * Reasons a suppression may be lifted. Unsubscribes and spam complaints are
 * deliberately permanent: re-consent has to come from the person themselves,
 * not from an operator clicking "remove".
 */
const REMOVABLE_REASONS = new Set(['bounce', 'manual']);

interface SuppressionRow {
  email_hash: string;
  reason: string;
  created_at: string;
  email_ciphertext: string | null;
  email_iv: string | null;
}

/** Suppression hashes are HMACs of the address under AUTH_PEPPER; this must match encryptEmail(). */
async function suppressionHash(env: Env, email: string): Promise<string> {
  return hmacHex(env.AUTH_PEPPER, `contact:${normalizeEmail(email)}`);
}

export async function handleSuppressionsList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT s.email_hash, s.reason, s.created_at, c.email_ciphertext, c.email_iv
     FROM suppressions s
     LEFT JOIN contacts c ON c.workspace_id = s.workspace_id AND c.email_hash = s.email_hash
     WHERE s.workspace_id = ?
     ORDER BY s.created_at DESC LIMIT 500`,
  )
    .bind(context.workspaceId)
    .all<SuppressionRow>();

  const suppressions = await Promise.all(
    rows.results.map(async (row) => {
      let email = '(erased contact)';
      if (row.email_ciphertext && row.email_iv) {
        email = await decryptEmail(env, row.email_ciphertext, row.email_iv)
          .then(maskEmail)
          .catch(() => '(unavailable)');
      }
      return {
        emailHash: row.email_hash,
        email,
        reason: row.reason,
        createdAt: row.created_at,
        removable: REMOVABLE_REASONS.has(row.reason),
      };
    }),
  );
  return json({ suppressions, count: suppressions.length });
}

export async function handleSuppressionCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const body = await readJson<{ email?: string }>(request);
  const email = normalizeEmail(String(body.email ?? ''));
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address to suppress.');
  const hash = await suppressionHash(env, email);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO suppressions (workspace_id, email_hash, reason, created_at) VALUES (?, ?, 'manual', ?)
     ON CONFLICT(workspace_id, email_hash) DO NOTHING`,
  )
    .bind(context.workspaceId, hash, now)
    .run();
  await audit(env, request, context, 'suppression.create', 'suppression', hash, { reason: 'manual' });
  return json({ ok: true }, 201);
}

export async function handleSuppressionDelete(request: Request, env: Env, context: AuthContext, hash: string): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const existing = await env.DB.prepare('SELECT reason FROM suppressions WHERE workspace_id = ? AND email_hash = ?')
    .bind(context.workspaceId, hash)
    .first<{ reason: string }>();
  if (!existing) throw new HttpError(404, 'Suppression not found.');
  if (!REMOVABLE_REASONS.has(existing.reason)) {
    throw new HttpError(
      409,
      'Unsubscribes and spam complaints cannot be lifted here. That person must opt in again themselves before you may email them.',
    );
  }
  await env.DB.prepare('DELETE FROM suppressions WHERE workspace_id = ? AND email_hash = ?')
    .bind(context.workspaceId, hash)
    .run();
  await audit(env, request, context, 'suppression.delete', 'suppression', hash, { reason: existing.reason });
  return json({ ok: true });
}
