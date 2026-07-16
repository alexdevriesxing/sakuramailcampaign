import type { AuthContext, Env } from '../types';
import { audit } from '../db';
import { capturePayPalOrder, createPayPalOrder } from '../paypal';
import { json, nowIso, randomId, sha256Hex } from '../security';
import {
  ALLOWED_FILE_TYPES,
  HttpError,
  MAX_FILE_BYTES,
  readJson,
  requireRole,
  sanitizeFilename,
} from '../http';

export async function handleFilesUpload(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin', 'editor']);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a file to upload.');
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new HttpError(400, 'File must be between 1 byte and 5 MiB.');
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_FILE_TYPES.has(contentType)) throw new HttpError(400, 'This file type is not allowed.');
  const filename = sanitizeFilename(file.name);
  const bytes = await file.arrayBuffer();
  const digest = await sha256Hex(bytes);
  const id = randomId('fil_');
  const r2Key = `${context.workspaceId}/${id}/${filename}`;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType }, customMetadata: { workspaceId: context.workspaceId, sha256: digest } });
  try {
    await env.DB.prepare(
      'INSERT INTO files (id, workspace_id, r2_key, filename, content_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, context.workspaceId, r2Key, filename, contentType, file.size, digest, nowIso())
      .run();
  } catch (error) {
    await env.FILES.delete(r2Key);
    throw error;
  }
  await audit(env, request, context, 'file.upload', 'file', id, { filename, size: file.size, contentType });
  return json({ id, filename }, 201);
}

export async function handleBillingCreate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const body = await readJson<{ quantityThousands?: number }>(request);
  const quantity = Number(body.quantityThousands);
  const minimum = Number(env.MIN_PURCHASE_THOUSANDS);
  if (!Number.isInteger(quantity) || quantity < minimum || quantity > 10_000) throw new HttpError(400, `Purchase between ${minimum.toLocaleString()} and 10,000 thousand-credit units.`);
  const unitCents = Math.round(Number(env.PRICE_PER_1000_USD) * 100);
  const amount = ((quantity * unitCents) / 100).toFixed(2);
  const internalOrderId = randomId('ord_');
  const order = await createPayPalOrder(env, { internalOrderId, workspaceId: context.workspaceId, quantityThousands: quantity, amount });
  await env.DB.prepare(
    `INSERT INTO billing_orders (id, workspace_id, paypal_order_id, quantity_thousands, amount_usd, status, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`,
  )
    .bind(internalOrderId, context.workspaceId, order.id, quantity, amount, JSON.stringify(order.raw), nowIso())
    .run();
  await audit(env, request, context, 'billing.order.create', 'billing_order', internalOrderId, { quantity, amount });
  return json({ paypalOrderId: order.id });
}

export async function handleBillingCapture(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const body = await readJson<{ orderId?: string }>(request);
  const orderId = String(body.orderId ?? '').trim();
  const record = await env.DB.prepare(
    'SELECT id, quantity_thousands, amount_usd, status FROM billing_orders WHERE workspace_id = ? AND paypal_order_id = ?',
  )
    .bind(context.workspaceId, orderId)
    .first<{ id: string; quantity_thousands: number; amount_usd: string; status: string }>();
  if (!record) throw new HttpError(404, 'Billing order not found.');
  if (record.status === 'completed') return json({ creditsAdded: record.quantity_thousands * 1000, alreadyCompleted: true });
  const capture = await capturePayPalOrder(env, orderId);
  if (capture.status !== 'COMPLETED' || capture.currency !== 'USD' || capture.amount !== record.amount_usd || capture.customId !== context.workspaceId) {
    await env.DB.prepare("UPDATE billing_orders SET status = 'failed', raw_json = ? WHERE id = ?").bind(JSON.stringify(capture.raw), record.id).run();
    throw new HttpError(400, 'PayPal confirmation did not match this order. No credits were added.');
  }
  const update = await env.DB.prepare(
    `UPDATE billing_orders SET status = 'completed', capture_id = ?, raw_json = ?, completed_at = ? WHERE id = ? AND status = 'created'`,
  )
    .bind(capture.captureId, JSON.stringify(capture.raw), nowIso(), record.id)
    .run();
  if ((update.meta.changes ?? 0) === 1) {
    await env.DB.prepare('UPDATE workspaces SET credits = credits + ?, updated_at = ? WHERE id = ?')
      .bind(record.quantity_thousands * 1000, nowIso(), context.workspaceId)
      .run();
  }
  await audit(env, request, context, 'billing.order.capture', 'billing_order', record.id, { amount: record.amount_usd, captureId: capture.captureId });
  return json({ creditsAdded: record.quantity_thousands * 1000 });
}

export async function handleSettingsUpdate(request: Request, env: Env, context: AuthContext): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const body = await readJson<Record<string, string>>(request);
  const workspaceName = String(body.workspaceName ?? '').trim().slice(0, 120);
  const businessName = String(body.businessName ?? '').trim().slice(0, 200);
  const postalAddress = String(body.postalAddress ?? '').trim().slice(0, 500);
  if (!workspaceName || !businessName || !postalAddress) throw new HttpError(400, 'Complete the workspace name, business name and postal address.');
  await env.DB.prepare(
    'UPDATE workspaces SET name = ?, business_name = ?, postal_address = ?, updated_at = ? WHERE id = ?',
  )
    .bind(workspaceName, businessName, postalAddress, nowIso(), context.workspaceId)
    .run();
  await audit(env, request, context, 'workspace.settings.update', 'workspace', context.workspaceId);
  return json({ ok: true });
}
