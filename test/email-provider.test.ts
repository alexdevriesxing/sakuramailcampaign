import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { base64FromContent, buildResendPayload, emailSender, formatFrom } from '../src/email-provider';

const baseInput = {
  to: 'person@example.test',
  from: { email: 'news@mail.example.test', name: 'Alex from Acme' },
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('formatFrom', () => {
  it('renders a display name in RFC 5322 form', () => {
    expect(formatFrom({ email: 'a@b.test', name: 'Alex from Acme' })).toBe('Alex from Acme <a@b.test>');
  });

  it('falls back to a bare address and passes strings through', () => {
    expect(formatFrom({ email: 'a@b.test' })).toBe('a@b.test');
    expect(formatFrom('Raw <a@b.test>')).toBe('Raw <a@b.test>');
  });
});

describe('base64FromContent', () => {
  it('encodes an ArrayBuffer', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(base64FromContent(bytes.buffer)).toBe('aGVsbG8=');
  });

  it('encodes a typed-array view respecting its offset', () => {
    const full = new TextEncoder().encode('XXhello');
    const view = new Uint8Array(full.buffer, 2, 5);
    expect(base64FromContent(view)).toBe('aGVsbG8=');
  });

  it('encodes a string', () => {
    expect(base64FromContent('hello')).toBe('aGVsbG8=');
  });

  it('handles content larger than one chunk without blowing the stack', () => {
    const big = new Uint8Array(100_000).fill(65); // 'A'
    const encoded = base64FromContent(big.buffer);
    expect(atob(encoded).length).toBe(100_000);
  });
});

describe('buildResendPayload', () => {
  it('maps the shared message shape onto Resend fields', () => {
    const payload = buildResendPayload({ ...baseInput, replyTo: 'alex@acme.test', headers: { 'List-Unsubscribe': '<https://u.test/1>' } });
    expect(payload.from).toBe('Alex from Acme <news@mail.example.test>');
    expect(payload.to).toEqual(['person@example.test']);
    expect(payload.reply_to).toBe('alex@acme.test');
    // Compliance headers must survive the provider swap.
    expect(payload.headers?.['List-Unsubscribe']).toBe('<https://u.test/1>');
  });

  it('omits optional fields rather than sending nulls', () => {
    const payload = buildResendPayload(baseInput);
    expect('reply_to' in payload).toBe(false);
    expect('attachments' in payload).toBe(false);
    expect('headers' in payload).toBe(false);
  });

  it('normalises a single recipient into an array', () => {
    expect(buildResendPayload({ ...baseInput, to: ['a@b.test', 'c@d.test'] }).to).toEqual(['a@b.test', 'c@d.test']);
  });

  it('base64-encodes attachments with their content type', () => {
    const payload = buildResendPayload({
      ...baseInput,
      attachments: [{ filename: 'a.txt', type: 'text/plain', disposition: 'attachment', content: new TextEncoder().encode('hello').buffer }],
    });
    expect(payload.attachments).toEqual([{ filename: 'a.txt', content: 'aGVsbG8=', content_type: 'text/plain' }]);
  });
});

describe('emailSender', () => {
  it('defaults to the Cloudflare binding', () => {
    const marker = { send: async () => ({ messageId: 'cf' }) };
    const fake = { EMAIL: marker } as unknown as Env;
    expect(emailSender(fake)).toBe(marker);
    expect(emailSender({ ...fake, EMAIL_PROVIDER: 'cloudflare' } as Env)).toBe(marker);
  });

  it('returns a different sender for resend', () => {
    const marker = { send: async () => ({ messageId: 'cf' }) };
    const fake = { EMAIL: marker, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' } as unknown as Env;
    expect(emailSender(fake)).not.toBe(marker);
  });

  it('fails loudly if resend is selected without an API key', async () => {
    const fake = { ...(env as unknown as Env), EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined } as Env;
    await expect(emailSender(fake).send(baseInput)).rejects.toThrow(/RESEND_API_KEY/);
  });
});
