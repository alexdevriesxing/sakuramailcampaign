import type { EmailAttachment, EmailBinding, Env } from './types';

/**
 * Delivery provider abstraction.
 *
 * Cloudflare Email Sending is documented as intended for transactional mail, so a
 * marketing workload may need to move to a provider that expressly permits it.
 * Everything else in this app (queueing, suppression, tracking, reporting) is
 * provider-agnostic; only this file knows how a message is physically sent.
 *
 * Switch with the EMAIL_PROVIDER var — no other code changes.
 */
export type EmailProvider = 'cloudflare' | 'resend';

export interface ResendPayload {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type: string }>;
}

/** RFC 5322 display-name form, e.g. `Alex from Acme <news@mail.example.com>`. */
export function formatFrom(from: { email: string; name?: string } | string): string {
  if (typeof from === 'string') return from;
  return from.name ? `${from.name} <${from.email}>` : from.email;
}

/** Base64-encode attachment bytes for JSON transports. Chunked to avoid blowing the stack. */
export function base64FromContent(content: EmailAttachment['content']): string {
  let bytes: Uint8Array;
  if (typeof content === 'string') bytes = new TextEncoder().encode(content);
  else if (content instanceof ArrayBuffer) bytes = new Uint8Array(content);
  else bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function buildResendPayload(input: Parameters<EmailBinding['send']>[0]): ResendPayload {
  return {
    from: formatFrom(input.from),
    to: Array.isArray(input.to) ? input.to : [input.to],
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.headers ? { headers: input.headers } : {}),
    ...(input.attachments?.length
      ? {
        attachments: input.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: base64FromContent(attachment.content),
          content_type: attachment.type,
        })),
      }
      : {}),
  };
}

function resendSender(env: Env): EmailBinding {
  return {
    async send(input) {
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured for the resend email provider.');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildResendPayload(input)),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!response.ok) {
        // Surface the provider's wording so isPermanentBounce() can classify hard
        // bounces the same way it does for Cloudflare.
        throw new Error(body.message ?? `Resend rejected the message (${response.status}).`);
      }
      return { messageId: body.id };
    },
  };
}

/** Resolve the configured delivery provider. Defaults to the Cloudflare binding. */
export function emailSender(env: Env): EmailBinding {
  if (env.EMAIL_PROVIDER === 'resend') return resendSender(env);
  return env.EMAIL;
}
