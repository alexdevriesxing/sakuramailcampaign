import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { isPermanentBounce, recordDeadLetter } from '../src/email';

const testEnv = env as unknown as Env;
const WS = 'ws_dl';
const CAMPAIGN = 'cmp_dl';
const NOW = '2026-07-01T00:00:00.000Z';

describe('isPermanentBounce', () => {
  // A false positive suppresses a real customer forever; a false negative just
  // retries. The classifier is deliberately conservative.
  it.each([
    '550 5.1.1 user unknown',
    'Recipient address rejected: User unknown',
    'No such user here',
    'invalid recipient',
    'mailbox unavailable',
    '554 delivery error',
    'Address rejected by the receiving server',
  ])('treats %j as a hard bounce', (message) => {
    expect(isPermanentBounce(message)).toBe(true);
  });

  it.each([
    '451 4.7.1 Greylisted, try again later',
    'Connection timed out',
    'Temporary failure, please retry later',
    'Service unavailable',
    'rate limited',
    '',
  ])('treats %j as transient and retryable', (message) => {
    expect(isPermanentBounce(message)).toBe(false);
  });
});

describe('recordDeadLetter', () => {
  beforeEach(async () => {
    const statements: D1PreparedStatement[] = [];
    for (const table of ['send_events', 'contacts', 'campaigns', 'workspaces', 'users']) {
      statements.push(env.DB.prepare(`DELETE FROM ${table}`));
    }
    statements.push(env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind('usr_dl', 'o@example.test', NOW));
    statements.push(
      env.DB.prepare('INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(WS, 'W', 'usr_dl', NOW, NOW),
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO campaigns (id, workspace_id, name, subject, from_name, from_email, html_body, text_body, status, audience_filter_json, recipient_count, sent_count, failed_count, created_at, updated_at)
           VALUES (?, ?, 'C', 'S', 'N', 'a@b.test', '<p>x</p>', 'x', 'sending', '{}', 1, 0, 0, ?, ?)`,
        )
        .bind(CAMPAIGN, WS, NOW, NOW),
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO contacts (id, workspace_id, email_ciphertext, email_iv, email_hash, status, created_at, updated_at)
           VALUES ('con_dl', ?, 'x', 'x', 'h', 'active', ?, ?)`,
        )
        .bind(WS, NOW, NOW),
    );
    // The job is mid-flight: retried and still queued.
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, error_code, created_at, updated_at)
           VALUES ('se_dl', ?, ?, 'con_dl', 'queued', 'DELIVERY_RETRY', ?, ?)`,
        )
        .bind(WS, CAMPAIGN, NOW, NOW),
    );
    await env.DB.batch(statements);
  });

  it('turns an abandoned job into a visible failure instead of losing it', async () => {
    await recordDeadLetter(testEnv, { workspaceId: WS, campaignId: CAMPAIGN, contactId: 'con_dl' });

    const event = await env.DB.prepare('SELECT status, error_code FROM send_events WHERE campaign_id = ? AND contact_id = ?')
      .bind(CAMPAIGN, 'con_dl')
      .first<{ status: string; error_code: string }>();
    expect(event?.status).toBe('failed');
    expect(event?.error_code).toBe('DEAD_LETTER');
  });

  it('refreshes campaign counts so the campaign can finalize', async () => {
    await recordDeadLetter(testEnv, { workspaceId: WS, campaignId: CAMPAIGN, contactId: 'con_dl' });

    const campaign = await env.DB.prepare('SELECT sent_count, failed_count FROM campaigns WHERE id = ?')
      .bind(CAMPAIGN)
      .first<{ sent_count: number; failed_count: number }>();
    expect(campaign?.failed_count).toBe(1);
    expect(campaign?.sent_count).toBe(0);
  });

  it('is idempotent if the same message is delivered twice', async () => {
    await recordDeadLetter(testEnv, { workspaceId: WS, campaignId: CAMPAIGN, contactId: 'con_dl' });
    await recordDeadLetter(testEnv, { workspaceId: WS, campaignId: CAMPAIGN, contactId: 'con_dl' });

    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM send_events WHERE campaign_id = ? AND contact_id = ?')
      .bind(CAMPAIGN, 'con_dl')
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });
});
