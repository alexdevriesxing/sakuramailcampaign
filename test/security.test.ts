import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import {
  checkOrigin,
  createTrackingToken,
  createUnsubscribeToken,
  decryptEmail,
  encryptEmail,
  verifyTrackingToken,
  verifyUnsubscribeToken,
} from '../src/security';
import { maskEmail, sanitizeFilename } from '../src/http';

const testEnv = env as unknown as Env;
const base = { workspaceId: 'ws_1', campaignId: 'cmp_1', contactId: 'con_1' };

describe('tracking tokens', () => {
  it('round-trips a payload', async () => {
    const token = await createTrackingToken(testEnv, base);
    await expect(verifyTrackingToken(testEnv, token)).resolves.toMatchObject(base);
  });

  it('binds the click URL into the signature', async () => {
    const token = await createTrackingToken(testEnv, { ...base, url: 'https://good.test/a' });
    const payload = await verifyTrackingToken(testEnv, token);
    expect(payload?.url).toBe('https://good.test/a');
  });

  it('rejects a tampered payload (no open redirect)', async () => {
    // Swap the payload for one pointing at an attacker URL, keeping the signature.
    const token = await createTrackingToken(testEnv, { ...base, url: 'https://good.test/a' });
    const signature = token.split('.')[1]!;
    const forgedPayload = btoa(JSON.stringify({ ...base, url: 'https://evil.test/phish' }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    await expect(verifyTrackingToken(testEnv, `${forgedPayload}.${signature}`)).resolves.toBeNull();
  });

  it('rejects a tampered signature and malformed tokens', async () => {
    const token = await createTrackingToken(testEnv, base);
    await expect(verifyTrackingToken(testEnv, `${token.split('.')[0]}.deadbeef`)).resolves.toBeNull();
    await expect(verifyTrackingToken(testEnv, 'garbage')).resolves.toBeNull();
    await expect(verifyTrackingToken(testEnv, '')).resolves.toBeNull();
  });
});

describe('unsubscribe tokens', () => {
  it('accepts a live token and rejects an expired one', async () => {
    const live = await createUnsubscribeToken(testEnv, { workspaceId: 'ws_1', contactId: 'con_1', expiresAt: Date.now() + 60_000 });
    await expect(verifyUnsubscribeToken(testEnv, live)).resolves.toMatchObject({ contactId: 'con_1' });

    const expired = await createUnsubscribeToken(testEnv, { workspaceId: 'ws_1', contactId: 'con_1', expiresAt: Date.now() - 1 });
    await expect(verifyUnsubscribeToken(testEnv, expired)).resolves.toBeNull();
  });

  it('does not accept a tracking token as an unsubscribe token', async () => {
    // Namespacing keeps the two token types from being swapped.
    const tracking = await createTrackingToken(testEnv, base);
    await expect(verifyUnsubscribeToken(testEnv, tracking)).resolves.toBeNull();
  });
});

describe('checkOrigin (CSRF)', () => {
  const post = (origin?: string) =>
    new Request('https://app.example.test/api/x', {
      method: 'POST',
      headers: origin ? { Origin: origin } : {},
    });

  it('allows same-origin requests', () => {
    expect(checkOrigin(post('https://app.example.test'), testEnv)).toBe(true);
  });

  it('allows the configured APP_URL origin', () => {
    expect(checkOrigin(post('https://mail.example.test'), testEnv)).toBe(true);
  });

  it('blocks cross-origin, missing and malformed origins', () => {
    expect(checkOrigin(post('https://evil.test'), testEnv)).toBe(false);
    expect(checkOrigin(post(), testEnv)).toBe(false);
    expect(checkOrigin(post('not-a-url'), testEnv)).toBe(false);
  });

  it('does not gate safe methods', () => {
    expect(checkOrigin(new Request('https://app.example.test/api/x'), testEnv)).toBe(true);
  });
});

describe('email encryption', () => {
  it('round-trips and normalises the address', async () => {
    const encrypted = await encryptEmail(testEnv, '  Person@Example.TEST ');
    await expect(decryptEmail(testEnv, encrypted.ciphertext, encrypted.iv)).resolves.toBe('person@example.test');
  });

  it('produces a stable hash but a fresh IV each time', async () => {
    const a = await encryptEmail(testEnv, 'person@example.test');
    const b = await encryptEmail(testEnv, 'person@example.test');
    expect(a.hash).toBe(b.hash); // deduplication depends on this
    expect(a.iv).not.toBe(b.iv); // but ciphertext must not be deterministic
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails closed on a corrupt ciphertext', async () => {
    await expect(decryptEmail(testEnv, 'not-real', 'not-real')).rejects.toBeTruthy();
  });
});

describe('output helpers', () => {
  it('keeps only the first two characters of the local part', () => {
    expect(maskEmail('person@example.test')).toBe('pe••••@example.test');
  });

  it('never reveals a short local part, padding to at least three dots', () => {
    expect(maskEmail('al@example.test')).toBe('al•••@example.test');
  });

  it('strips path separators and control characters from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('')).toBe('attachment');
  });
});
