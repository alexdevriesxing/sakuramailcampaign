import type { AuthContext, Env } from '../types';
import { decryptEmail, encryptEmail, isValidEmail, json, normalizeEmail, nowIso, randomId } from '../security';
import { HttpError, maskEmail, requireRole } from '../http';

export async function handleContactsList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, email_ciphertext, email_iv, first_name, last_name, consent_status, consent_source, status, created_at
     FROM contacts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 250`,
  )
    .bind(context.workspaceId)
    .all<{
      id: string;
      email_ciphertext: string;
      email_iv: string;
      first_name: string | null;
      last_name: string | null;
      consent_status: string;
      consent_source: string | null;
      status: string;
      created_at: string;
    }>();
  const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ?').bind(context.workspaceId).first<{ count: number }>();
  const contacts = await Promise.all(
    rows.results.map(async (row) => ({
      id: row.id,
      masked_email: maskEmail(await decryptEmail(env, row.email_ciphertext, row.email_iv)),
      first_name: row.first_name,
      last_name: row.last_name,
      consent_status: row.consent_status,
      consent_source: row.consent_source,
      status: row.status,
      created_at: row.created_at,
    })),
  );
  return json({ contacts, total: total?.count ?? contacts.length });
}

export interface ContactInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  consentStatus?: string;
  consentSource?: string;
  consentAt?: string | null;
  metadata?: Record<string, unknown>;
}

export async function importContacts(env: Env, context: AuthContext, contacts: ContactInput[]): Promise<{ created: number; updated: number; rejected: number }> {
  requireRole(context, ['owner', 'admin', 'editor']);
  if (contacts.length > 1000) throw new HttpError(400, 'Import up to 1,000 contacts per request.');
  const allowedConsent = new Set(['express', 'implied', 'transactional', 'unknown']);
  let created = 0;
  let updated = 0;
  let rejected = 0;
  const statements: D1PreparedStatement[] = [];
  for (const input of contacts) {
    const email = normalizeEmail(input.email ?? '');
    if (!isValidEmail(email)) {
      rejected += 1;
      continue;
    }
    const encrypted = await encryptEmail(env, email);
    const exists = await env.DB.prepare('SELECT id FROM contacts WHERE workspace_id = ? AND email_hash = ?')
      .bind(context.workspaceId, encrypted.hash)
      .first<{ id: string }>();
    const now = nowIso();
    const consentStatus = allowedConsent.has(input.consentStatus ?? '') ? input.consentStatus! : 'unknown';
    if (exists) {
      updated += 1;
      statements.push(
        env.DB.prepare(
          `UPDATE contacts SET email_ciphertext = ?, email_iv = ?, first_name = ?, last_name = ?, metadata_json = ?, consent_status = ?, consent_source = ?, consent_at = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          encrypted.ciphertext,
          encrypted.iv,
          String(input.firstName ?? '').slice(0, 120) || null,
          String(input.lastName ?? '').slice(0, 120) || null,
          JSON.stringify(input.metadata ?? {}),
          consentStatus,
          String(input.consentSource ?? '').slice(0, 300) || null,
          input.consentAt ? new Date(input.consentAt).toISOString() : null,
          now,
          exists.id,
          context.workspaceId,
        ),
      );
    } else {
      created += 1;
      statements.push(
        env.DB.prepare(
          `INSERT INTO contacts (id, workspace_id, email_ciphertext, email_iv, email_hash, first_name, last_name, metadata_json, consent_status, consent_source, consent_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          randomId('con_'),
          context.workspaceId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.hash,
          String(input.firstName ?? '').slice(0, 120) || null,
          String(input.lastName ?? '').slice(0, 120) || null,
          JSON.stringify(input.metadata ?? {}),
          consentStatus,
          String(input.consentSource ?? '').slice(0, 300) || null,
          input.consentAt ? new Date(input.consentAt).toISOString() : null,
          now,
          now,
        ),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 75) await env.DB.batch(statements.slice(index, index + 75));
  return { created, updated, rejected };
}
