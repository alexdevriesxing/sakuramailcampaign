import type { AuthContext, Env } from '../types';
import { audit } from '../db';
import { HttpError, readJson, requireRole } from '../http';
import { json, nowIso, randomId } from '../security';

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  html_body: string;
  text_body: string;
  created_at: string;
  updated_at: string;
}

function templateFields(body: Record<string, unknown>) {
  return {
    name: String(body.name ?? '').trim().slice(0, 120),
    subject: String(body.subject ?? '').trim().slice(0, 998),
    preheader: String(body.preheader ?? '').trim().slice(0, 255),
    htmlBody: String(body.htmlBody ?? '').slice(0, 500_000),
    textBody: String(body.textBody ?? '').slice(0, 500_000),
  };
}

export async function handleTemplatesList(env: Env, context: AuthContext): Promise<Response> {
  const rows = await env.DB.prepare(
    'SELECT id, name, subject, preheader, html_body, text_body, created_at, updated_at FROM templates WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(context.workspaceId)
    .all<TemplateRow>();
  return json({
    templates: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      preheader: row.preheader,
      htmlBody: row.html_body,
      textBody: row.text_body,
      updatedAt: row.updated_at,
    })),
  });
}

export async function handleTemplateCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const fields = templateFields(await readJson<Record<string, unknown>>(request));
  if (!fields.name) throw new HttpError(400, 'Enter a template name.');
  if (!fields.htmlBody) throw new HttpError(400, 'A template needs HTML content.');
  const id = randomId('tpl_');
  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO templates (id, workspace_id, name, subject, preheader, html_body, text_body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, context.workspaceId, fields.name, fields.subject, fields.preheader, fields.htmlBody, fields.textBody, now, now)
    .run();
  await audit(env, request, context, 'template.create', 'template', id, { name: fields.name });
  return json({ id }, 201);
}

export async function handleTemplateUpdate(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const current = await env.DB.prepare('SELECT id FROM templates WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).first();
  if (!current) throw new HttpError(404, 'Template not found.');
  const fields = templateFields(await readJson<Record<string, unknown>>(request));
  if (!fields.name) throw new HttpError(400, 'Enter a template name.');
  await env.DB.prepare(
    'UPDATE templates SET name = ?, subject = ?, preheader = ?, html_body = ?, text_body = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
  )
    .bind(fields.name, fields.subject, fields.preheader, fields.htmlBody, fields.textBody, nowIso(), id, context.workspaceId)
    .run();
  await audit(env, request, context, 'template.update', 'template', id, { name: fields.name });
  return json({ ok: true });
}

export async function handleTemplateDelete(request: Request, env: Env, context: AuthContext, id: string): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const result = await env.DB.prepare('DELETE FROM templates WHERE id = ? AND workspace_id = ?').bind(id, context.workspaceId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, 'Template not found.');
  await audit(env, request, context, 'template.delete', 'template', id);
  return json({ ok: true });
}
