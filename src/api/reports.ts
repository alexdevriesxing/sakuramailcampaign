import type { AuthContext, Env } from '../types';
import { json } from '../security';
import { HttpError } from '../http';

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
    series: fillSeries(series.results),
    campaigns: campaigns.results,
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
