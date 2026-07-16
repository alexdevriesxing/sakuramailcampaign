import type { AuthContext, Env } from '../types';
import { decryptEmail, json } from '../security';
import { HttpError, requireRole } from '../http';

interface SendTotalsRow {
  total: number;
  accepted: number;
  failed: number;
  bounced: number;
  complained: number;
  queued: number;
}

interface DaySeriesRow {
  day: string;
  accepted: number;
  failed: number;
}

interface DayPoint {
  day: string;
  accepted: number;
  failed: number;
}

interface CountByKeyRow {
  key: string;
  count: number;
}

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(offsetDaysAgo: number): string {
  return new Date(Date.now() - offsetDaysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** Build a continuous WINDOW_DAYS series, filling missing days with zeroes. */
function fillSeries(rows: readonly DaySeriesRow[]): DayPoint[] {
  const byDay = new Map<string, DayPoint>();
  for (const row of rows) {
    byDay.set(row.day, { day: row.day, accepted: Number(row.accepted) || 0, failed: Number(row.failed) || 0 });
  }
  const points: DayPoint[] = [];
  for (let offset = WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const day = isoDay(offset);
    points.push(byDay.get(day) ?? { day, accepted: 0, failed: 0 });
  }
  return points;
}

function deliveryRate(accepted: number, failed: number): number | null {
  const attempted = accepted + failed;
  return attempted > 0 ? accepted / attempted : null;
}

export async function handleWorkspaceReports(env: Env, context: AuthContext): Promise<Response> {
  const workspaceId = context.workspaceId;
  const since = isoDay(WINDOW_DAYS - 1);

  const [totals, series, campaigns, failures, contactsByStatus, contactsByConsent, suppressions, billing] = await Promise.all([
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END), 0) AS bounced,
        COALESCE(SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END), 0) AS complained,
        COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued
       FROM send_events WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<SendTotalsRow>(),
    env.DB.prepare(
      `SELECT date(created_at) AS day,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status IN ('failed', 'bounced', 'complained') THEN 1 ELSE 0 END), 0) AS failed
       FROM send_events
       WHERE workspace_id = ? AND date(created_at) >= ?
       GROUP BY day ORDER BY day`,
    )
      .bind(workspaceId, since)
      .all<DaySeriesRow>(),
    env.DB.prepare(
      `SELECT id, name, subject, status, recipient_count, sent_count, failed_count, sent_at, created_at
       FROM campaigns
       WHERE workspace_id = ? AND status IN ('sending', 'sent', 'failed', 'paused')
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 15`,
    )
      .bind(workspaceId)
      .all(),
    env.DB.prepare(
      `SELECT COALESCE(error_code, 'UNKNOWN') AS key, COUNT(*) AS count
       FROM send_events
       WHERE workspace_id = ? AND status IN ('failed', 'bounced', 'complained')
       GROUP BY key ORDER BY count DESC LIMIT 8`,
    )
      .bind(workspaceId)
      .all<CountByKeyRow>(),
    env.DB.prepare('SELECT status AS key, COUNT(*) AS count FROM contacts WHERE workspace_id = ? GROUP BY status ORDER BY count DESC')
      .bind(workspaceId)
      .all<CountByKeyRow>(),
    env.DB.prepare('SELECT consent_status AS key, COUNT(*) AS count FROM contacts WHERE workspace_id = ? GROUP BY consent_status ORDER BY count DESC')
      .bind(workspaceId)
      .all<CountByKeyRow>(),
    env.DB.prepare('SELECT reason AS key, COUNT(*) AS count FROM suppressions WHERE workspace_id = ? GROUP BY reason ORDER BY count DESC')
      .bind(workspaceId)
      .all<CountByKeyRow>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(CAST(amount_usd AS REAL)), 0) AS spent,
        COUNT(*) AS orders,
        COALESCE(SUM(quantity_thousands), 0) AS credit_units
       FROM billing_orders WHERE workspace_id = ? AND status = 'completed'`,
    )
      .bind(workspaceId)
      .first<{ spent: number; orders: number; credit_units: number }>(),
  ]);

  const accepted = Number(totals?.accepted ?? 0);
  const failed = Number(totals?.failed ?? 0) + Number(totals?.bounced ?? 0) + Number(totals?.complained ?? 0);

  const [openTotals, clickTotals, topLinks, campaignOpens, campaignClicks] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS unique_openers, COALESCE(SUM(hits), 0) AS total_opens FROM email_opens WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ unique_openers: number; total_opens: number }>(),
    env.DB.prepare('SELECT COUNT(DISTINCT contact_id) AS unique_clickers, COALESCE(SUM(hits), 0) AS total_clicks FROM email_clicks WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ unique_clickers: number; total_clicks: number }>(),
    env.DB.prepare('SELECT url, COUNT(DISTINCT contact_id) AS clickers, COALESCE(SUM(hits), 0) AS clicks FROM email_clicks WHERE workspace_id = ? GROUP BY url ORDER BY clicks DESC LIMIT 8')
      .bind(workspaceId)
      .all<{ url: string; clickers: number; clicks: number }>(),
    env.DB.prepare('SELECT campaign_id, COUNT(*) AS openers, COALESCE(SUM(hits), 0) AS opens FROM email_opens WHERE workspace_id = ? GROUP BY campaign_id')
      .bind(workspaceId)
      .all<{ campaign_id: string; openers: number; opens: number }>(),
    env.DB.prepare('SELECT campaign_id, COUNT(DISTINCT contact_id) AS clickers, COALESCE(SUM(hits), 0) AS clicks FROM email_clicks WHERE workspace_id = ? GROUP BY campaign_id')
      .bind(workspaceId)
      .all<{ campaign_id: string; clickers: number; clicks: number }>(),
  ]);

  const opensByCampaign = new Map(campaignOpens.results.map((row) => [row.campaign_id, row]));
  const clicksByCampaign = new Map(campaignClicks.results.map((row) => [row.campaign_id, row]));
  const campaignsEnriched = (campaigns.results as Array<Record<string, unknown>>).map((row) => {
    const id = row.id as string;
    const open = opensByCampaign.get(id);
    const click = clicksByCampaign.get(id);
    return {
      ...row,
      unique_openers: Number(open?.openers ?? 0),
      total_opens: Number(open?.opens ?? 0),
      unique_clickers: Number(click?.clickers ?? 0),
      total_clicks: Number(click?.clicks ?? 0),
    };
  });

  const uniqueOpeners = Number(openTotals?.unique_openers ?? 0);
  const uniqueClickers = Number(clickTotals?.unique_clickers ?? 0);

  return json({
    windowDays: WINDOW_DAYS,
    totals: {
      accepted,
      failed,
      bounced: Number(totals?.bounced ?? 0),
      complained: Number(totals?.complained ?? 0),
      queued: Number(totals?.queued ?? 0),
      attempted: accepted + failed,
      deliveryRate: deliveryRate(accepted, failed),
    },
    engagement: {
      uniqueOpeners,
      totalOpens: Number(openTotals?.total_opens ?? 0),
      uniqueClickers,
      totalClicks: Number(clickTotals?.total_clicks ?? 0),
      openRate: accepted > 0 ? uniqueOpeners / accepted : null,
      clickRate: accepted > 0 ? uniqueClickers / accepted : null,
      clickToOpenRate: uniqueOpeners > 0 ? uniqueClickers / uniqueOpeners : null,
    },
    topLinks: topLinks.results,
    series: fillSeries(series.results),
    campaigns: campaignsEnriched,
    failures: failures.results,
    contactsByStatus: contactsByStatus.results,
    contactsByConsent: contactsByConsent.results,
    suppressions: suppressions.results,
    billing: {
      spentUsd: Number(billing?.spent ?? 0),
      orders: Number(billing?.orders ?? 0),
      creditsPurchased: Number(billing?.credit_units ?? 0) * 1000,
    },
  });
}

interface RecipientRow {
  contact_id: string;
  delivery_status: string;
  email_ciphertext: string;
  email_iv: string;
  first_name: string | null;
  last_name: string | null;
  open_hits: number | null;
  open_last: string | null;
  click_hits: number | null;
  last_click: string | null;
  links_clicked: number | null;
}

function csvCell(value: string | number | null): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Per-recipient open/click detail for one campaign. Decrypts addresses, so it is
 * restricted to owner/admin and is workspace-scoped. Supports ?format=csv export.
 */
export async function handleCampaignRecipients(request: Request, env: Env, context: AuthContext, campaignId: string): Promise<Response> {
  requireRole(context, ['owner', 'admin']);
  const campaign = await env.DB.prepare('SELECT name FROM campaigns WHERE id = ? AND workspace_id = ?')
    .bind(campaignId, context.workspaceId)
    .first<{ name: string }>();
  if (!campaign) throw new HttpError(404, 'Campaign not found.');

  const rows = await env.DB.prepare(
    `SELECT se.contact_id, se.status AS delivery_status,
        c.email_ciphertext, c.email_iv, c.first_name, c.last_name,
        o.hits AS open_hits, o.last_at AS open_last,
        cl.click_hits, cl.last_click, cl.links_clicked
     FROM send_events se
     JOIN contacts c ON c.id = se.contact_id AND c.workspace_id = se.workspace_id
     LEFT JOIN email_opens o ON o.campaign_id = se.campaign_id AND o.contact_id = se.contact_id
     LEFT JOIN (
       SELECT campaign_id, contact_id, SUM(hits) AS click_hits, MAX(last_at) AS last_click, COUNT(*) AS links_clicked
       FROM email_clicks GROUP BY campaign_id, contact_id
     ) cl ON cl.campaign_id = se.campaign_id AND cl.contact_id = se.contact_id
     WHERE se.workspace_id = ? AND se.campaign_id = ?
     ORDER BY (cl.click_hits IS NOT NULL) DESC, (o.hits IS NOT NULL) DESC, c.created_at DESC
     LIMIT 5000`,
  )
    .bind(context.workspaceId, campaignId)
    .all<RecipientRow>();

  const recipients = await Promise.all(
    rows.results.map(async (row) => ({
      email: await decryptEmail(env, row.email_ciphertext, row.email_iv).catch(() => '(unavailable)'),
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      deliveryStatus: row.delivery_status,
      opened: (row.open_hits ?? 0) > 0,
      openCount: Number(row.open_hits ?? 0),
      lastOpen: row.open_last,
      clicked: (row.click_hits ?? 0) > 0,
      clickCount: Number(row.click_hits ?? 0),
      linksClicked: Number(row.links_clicked ?? 0),
      lastClick: row.last_click,
    })),
  );

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const header = 'email,first_name,last_name,delivery_status,opened,open_count,last_open,clicked,click_count,last_click';
    const lines = recipients.map((r) =>
      [r.email, r.firstName, r.lastName, r.deliveryStatus, r.opened ? 'yes' : 'no', r.openCount, r.lastOpen, r.clicked ? 'yes' : 'no', r.clickCount, r.lastClick]
        .map(csvCell)
        .join(','),
    );
    const safeName = campaign.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'campaign';
    return new Response([header, ...lines].join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-recipients.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return json({ campaignName: campaign.name, count: recipients.length, recipients });
}

export async function handlePlatformStats(env: Env, context: AuthContext): Promise<Response> {
  if (!context.isPlatformAdmin) throw new HttpError(403, 'Platform administrator access required.');
  const since = isoDay(WINDOW_DAYS - 1);

  const [users, workspaces, totals, revenue, campaigns, suppressions, series] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM workspaces').first<{ count: number }>(),
    env.DB.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status IN ('failed', 'bounced', 'complained') THEN 1 ELSE 0 END), 0) AS failed
       FROM send_events`,
    ).first<{ accepted: number; failed: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(CAST(amount_usd AS REAL)), 0) AS total, COUNT(*) AS orders FROM billing_orders WHERE status = 'completed'")
      .first<{ total: number; orders: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM campaigns').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM suppressions').first<{ count: number }>(),
    env.DB.prepare(
      `SELECT date(created_at) AS day,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status IN ('failed', 'bounced', 'complained') THEN 1 ELSE 0 END), 0) AS failed
       FROM send_events WHERE date(created_at) >= ?
       GROUP BY day ORDER BY day`,
    )
      .bind(since)
      .all<DaySeriesRow>(),
  ]);

  const accepted = Number(totals?.accepted ?? 0);
  const failed = Number(totals?.failed ?? 0);

  return json({
    users: Number(users?.count ?? 0),
    workspaces: Number(workspaces?.count ?? 0),
    campaigns: Number(campaigns?.count ?? 0),
    suppressions: Number(suppressions?.count ?? 0),
    acceptedSends: accepted,
    failedSends: failed,
    deliveryRate: deliveryRate(accepted, failed),
    revenueUsd: Number(revenue?.total ?? 0),
    revenueOrders: Number(revenue?.orders ?? 0),
    windowDays: WINDOW_DAYS,
    series: fillSeries(series.results),
  });
}
