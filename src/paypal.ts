import type { Env } from './types';

function apiBase(env: Env): string {
  return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function accessToken(env: Env): Promise<string> {
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`PayPal authentication failed (${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('PayPal did not return an access token.');
  return body.access_token;
}

export async function createPayPalOrder(
  env: Env,
  input: { internalOrderId: string; workspaceId: string; quantityThousands: number; amount: string },
): Promise<{ id: string; status: string; raw: unknown }> {
  const token = await accessToken(env);
  const response = await fetch(`${apiBase(env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.internalOrderId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.internalOrderId,
          custom_id: input.workspaceId,
          description: `${input.quantityThousands.toLocaleString()} thousand Sakura Mail email credits`,
          amount: { currency_code: 'USD', value: input.amount },
        },
      ],
      application_context: {
        brand_name: env.APP_NAME,
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });
  const raw = (await response.json()) as { id?: string; status?: string; message?: string };
  if (!response.ok || !raw.id) throw new Error(raw.message ?? `PayPal order creation failed (${response.status}).`);
  return { id: raw.id, status: raw.status ?? 'CREATED', raw };
}

export async function capturePayPalOrder(env: Env, orderId: string): Promise<{
  id: string;
  status: string;
  amount: string;
  currency: string;
  customId: string | null;
  captureId: string | null;
  raw: unknown;
}> {
  const token = await accessToken(env);
  const response = await fetch(`${apiBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `capture-${orderId}`,
    },
    body: '{}',
  });
  const raw = (await response.json()) as {
    id?: string;
    status?: string;
    message?: string;
    purchase_units?: Array<{
      custom_id?: string;
      payments?: { captures?: Array<{ id?: string; amount?: { value?: string; currency_code?: string } }> };
    }>;
  };
  if (!response.ok) throw new Error(raw.message ?? `PayPal capture failed (${response.status}).`);
  const unit = raw.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    id: raw.id ?? orderId,
    status: raw.status ?? 'UNKNOWN',
    amount: capture?.amount?.value ?? '',
    currency: capture?.amount?.currency_code ?? '',
    customId: unit?.custom_id ?? null,
    captureId: capture?.id ?? null,
    raw,
  };
}
