import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { countAudience, sanitizeAudienceRules } from '../src/api/audience';

const testEnv = env as unknown as Env;
const WS = 'ws_test';
const CAMPAIGN = 'cmp_test';
const NOW = '2026-07-01T00:00:00.000Z';

/**
 * Fixture shape:
 *   contacts 0-7   active        8-9 unsubscribed   10 bounced   11 complained
 *   contact "never" is active but was never sent the campaign
 *   contact 3 is active but suppressed
 *   delivered (accepted) for contacts 0-9 only
 *   opened:  0,1,2,3,4      clicked: 0,1,2
 * => eligible base (active AND unsuppressed) = {0,1,2,4,5,6,7,never} = 8
 */
async function seed(): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  const push = (sql: string, ...binds: unknown[]) => statements.push(env.DB.prepare(sql).bind(...binds));

  for (const table of ['email_clicks', 'email_opens', 'send_events', 'suppressions', 'contacts', 'campaigns', 'memberships', 'workspaces', 'users']) {
    statements.push(env.DB.prepare(`DELETE FROM ${table}`));
  }
  push('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'usr_test', 'owner@example.test', NOW);
  push('INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', WS, 'Test', 'usr_test', NOW, NOW);
  push(
    `INSERT INTO campaigns (id, workspace_id, name, subject, from_name, from_email, html_body, text_body, status, audience_filter_json, created_at, updated_at)
     VALUES (?, ?, 'C', 'S', 'N', 'a@b.test', '<p>x</p>', 'x', 'sent', '{}', ?, ?)`,
    CAMPAIGN,
    WS,
    NOW,
    NOW,
  );

  const statuses = ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'unsubscribed', 'unsubscribed', 'bounced', 'complained'];
  const ids = [...statuses.map((_, i) => `c${i}`), 'never'];
  statuses.forEach((status, i) => {
    push(
      `INSERT INTO contacts (id, workspace_id, email_ciphertext, email_iv, email_hash, status, created_at, updated_at)
       VALUES (?, ?, 'x', 'x', ?, ?, ?, ?)`,
      `c${i}`,
      WS,
      `h${i}`,
      status,
      NOW,
      NOW,
    );
  });
  push(
    `INSERT INTO contacts (id, workspace_id, email_ciphertext, email_iv, email_hash, status, created_at, updated_at)
     VALUES ('never', ?, 'x', 'x', 'hnever', 'active', ?, ?)`,
    WS,
    NOW,
    NOW,
  );
  // Contact 3 is active but suppressed, proving suppression excludes independently of status.
  push("INSERT INTO suppressions (workspace_id, email_hash, reason, created_at) VALUES (?, 'h3', 'manual', ?)", WS, NOW);

  // Delivered to contacts 0-9; 10 bounced, 11 complained; "never" gets nothing.
  for (let i = 0; i < 12; i += 1) {
    const status = i === 10 ? 'bounced' : i === 11 ? 'complained' : 'accepted';
    push(
      `INSERT INTO send_events (id, workspace_id, campaign_id, contact_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `se${i}`,
      WS,
      CAMPAIGN,
      `c${i}`,
      status,
      NOW,
      NOW,
    );
  }
  for (const i of [0, 1, 2, 3, 4]) {
    push('INSERT INTO email_opens (workspace_id, campaign_id, contact_id, hits, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)', WS, CAMPAIGN, `c${i}`, NOW, NOW);
  }
  for (const i of [0, 1, 2]) {
    push(
      "INSERT INTO email_clicks (workspace_id, campaign_id, contact_id, url_hash, url, hits, first_at, last_at) VALUES (?, ?, ?, 'u1', 'https://x.test', 1, ?, ?)",
      WS,
      CAMPAIGN,
      `c${i}`,
      NOW,
      NOW,
    );
  }
  void ids;
  await env.DB.batch(statements);
}

const rules = (engagementFilter: string) => sanitizeAudienceRules({ engagementFilter, engagementCampaignId: CAMPAIGN });

describe('audience targeting', () => {
  beforeEach(seed);

  it('excludes unsubscribed, bounced, complained and suppressed contacts', async () => {
    // 12 contacts + "never"; only 0,1,2,4,5,6,7 and "never" are mailable.
    await expect(countAudience(testEnv, WS, {})).resolves.toBe(8);
  });

  it('counts only engaged contacts that are still mailable', async () => {
    // c3 opened but is suppressed, so it must not appear.
    await expect(countAudience(testEnv, WS, rules('opened'))).resolves.toBe(4);
    await expect(countAudience(testEnv, WS, rules('clicked'))).resolves.toBe(3);
  });

  it('treats "did not open" as delivered-but-unopened, never as "was never sent"', async () => {
    // The regression this guards: "never" is active and has no open, but was never
    // sent the campaign, so it is not a non-opener.
    await expect(countAudience(testEnv, WS, rules('not_opened'))).resolves.toBe(3);
    await expect(countAudience(testEnv, WS, rules('not_clicked'))).resolves.toBe(4);
  });

  it('keeps opened and not-opened a partition of the delivered, mailable audience', async () => {
    const opened = await countAudience(testEnv, WS, rules('opened'));
    const notOpened = await countAudience(testEnv, WS, rules('not_opened'));
    const clicked = await countAudience(testEnv, WS, rules('clicked'));
    const notClicked = await countAudience(testEnv, WS, rules('not_clicked'));
    expect(opened + notOpened).toBe(7);
    expect(clicked + notClicked).toBe(7);
  });

  it('applies maxRecipients as a cap', async () => {
    await expect(countAudience(testEnv, WS, { maxRecipients: 3 })).resolves.toBe(3);
  });
});

describe('sanitizeAudienceRules', () => {
  it('ignores an engagement filter with no campaign, and vice versa', () => {
    expect(sanitizeAudienceRules({ engagementFilter: 'not_opened' }).engagementFilter).toBe('any');
    expect(sanitizeAudienceRules({ engagementCampaignId: 'cmp_x' }).engagementCampaignId).toBeNull();
  });

  it('rejects unknown filters and sort fields', () => {
    expect(sanitizeAudienceRules({ engagementFilter: 'evil', engagementCampaignId: 'c' }).engagementFilter).toBe('any');
    expect(sanitizeAudienceRules({ sortBy: 'password' }).sortBy).toBe('created_at');
  });

  it('keeps a valid engagement pair', () => {
    const parsed = sanitizeAudienceRules({ engagementFilter: 'clicked', engagementCampaignId: 'cmp_1' });
    expect(parsed.engagementFilter).toBe('clicked');
    expect(parsed.engagementCampaignId).toBe('cmp_1');
  });
});
