import { $, api, escapeHtml, formatNumber } from './shared.js';
import { statusPill } from './dashboard-context.js';

export const COLORS = {
  accepted: '#2f9e63',
  failed: '#d76d64',
  amber: '#c98a1e',
  pink: '#ec4882',
  muted: '#c9b4bd',
};

const STATUS_PALETTE = ['#2f9e63', '#d76d64', '#c98a1e', '#8a6d9e'];
const CONSENT_PALETTE = ['#2f9e63', '#4f86c6', '#c98a1e', '#c9b4bd'];
const REASON_PALETTE = ['#d76d64', '#c98a1e', '#8a6d9e', '#4f86c6', '#b0567d', '#6d9e8a', '#9e8a6d', '#c9b4bd'];

function labelize(key) {
  const value = String(key ?? 'unknown').replace(/_/g, ' ').trim() || 'unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortDay(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function ratePill(rate) {
  if (rate == null) return '<span class="rate-pill none">—</span>';
  const pct = Math.round(rate * 100);
  const cls = rate >= 0.95 ? 'good' : rate >= 0.8 ? 'ok' : 'bad';
  return `<span class="rate-pill ${cls}">${pct}%</span>`;
}

function percent(rate) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

/** Stacked delivered/failed bar chart as inline SVG (no external libraries; CSP-safe). */
export function sendsChart(series = []) {
  const width = 760;
  const height = 220;
  const padX = 34;
  const padTop = 18;
  const padBottom = 26;
  const plotH = height - padTop - padBottom;
  const baseY = padTop + plotH;
  const n = series.length || 1;
  const max = Math.max(1, ...series.map((d) => Number(d.accepted) + Number(d.failed)));
  const slot = (width - padX * 2) / n;
  const barW = Math.min(18, slot * 0.66);

  const bars = series
    .map((d, i) => {
      const centre = padX + slot * i + slot / 2;
      const x = centre - barW / 2;
      const accepted = Number(d.accepted) || 0;
      const failed = Number(d.failed) || 0;
      const aH = (accepted / max) * plotH;
      const fH = (failed / max) * plotH;
      const aY = baseY - aH;
      const fY = aY - fH;
      const title = `${shortDay(d.day)}: ${formatNumber(accepted)} delivered, ${formatNumber(failed)} failed`;
      return (
        `<g><title>${escapeHtml(title)}</title>` +
        (aH > 0.4 ? `<rect x="${x.toFixed(1)}" y="${aY.toFixed(1)}" width="${barW.toFixed(1)}" height="${aH.toFixed(1)}" rx="2" fill="${COLORS.accepted}"/>` : '') +
        (fH > 0.4 ? `<rect x="${x.toFixed(1)}" y="${fY.toFixed(1)}" width="${barW.toFixed(1)}" height="${fH.toFixed(1)}" rx="2" fill="${COLORS.failed}"/>` : '') +
        '</g>'
      );
    })
    .join('');

  const labelIndexes = [...new Set([0, Math.floor(n / 2), n - 1])];
  const xLabels = labelIndexes
    .map((i) => {
      const point = series[i];
      if (!point) return '';
      const centre = padX + slot * i + slot / 2;
      return `<text x="${centre.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" class="chart-axis">${escapeHtml(shortDay(point.day))}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Delivered and failed sends over the last ${series.length} days" preserveAspectRatio="xMidYMid meet">
    <line x1="${padX}" y1="${padTop}" x2="${width - padX}" y2="${padTop}" class="chart-grid"/>
    <line x1="${padX}" y1="${baseY}" x2="${width - padX}" y2="${baseY}" class="chart-base"/>
    <text x="${padX - 6}" y="${(padTop + 4).toFixed(1)}" text-anchor="end" class="chart-axis">${formatNumber(max)}</text>
    <text x="${padX - 6}" y="${baseY.toFixed(1)}" text-anchor="end" class="chart-axis">0</text>
    ${bars}${xLabels}
  </svg>`;
}

export function chartLegend() {
  return `<div class="chart-legend"><span><i style="background:${COLORS.accepted}"></i>Delivered</span><span><i style="background:${COLORS.failed}"></i>Failed</span></div>`;
}

function emptyState(message) {
  return `<div class="empty-card small">${escapeHtml(message)}</div>`;
}

function breakdownList(items = [], palette = REASON_PALETTE) {
  if (!items.length) return emptyState('No data yet.');
  const total = items.reduce((sum, item) => sum + Number(item.count), 0) || 1;
  return `<ul class="breakdown">${items
    .map((item, i) => {
      const count = Number(item.count) || 0;
      const pct = Math.round((count / total) * 100);
      const color = palette[i % palette.length];
      return `<li><div class="breakdown-row"><span class="dot" style="background:${color}"></span><b>${escapeHtml(labelize(item.key))}</b><span class="breakdown-count">${formatNumber(count)}</span></div><div class="mini-bar"><span style="width:${pct}%;background:${color}"></span></div></li>`;
    })
    .join('')}</ul>`;
}

function campaignPerformance(rows = []) {
  if (!rows.length) return emptyState('No sent campaigns yet — performance appears once a campaign delivers.');
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Campaign</th><th>Status</th><th>Recipients</th><th>Delivered</th><th>Opens</th><th>Clicks</th><th>Failed</th><th>Delivery rate</th></tr></thead><tbody>${rows
    .map((c) => {
      const delivered = Number(c.sent_count) || 0;
      const failed = Number(c.failed_count) || 0;
      const attempted = delivered + failed;
      const rate = attempted ? delivered / attempted : null;
      const pct = rate == null ? 0 : Math.round(rate * 100);
      const color = rate == null ? COLORS.muted : rate >= 0.95 ? COLORS.accepted : rate >= 0.8 ? COLORS.amber : COLORS.failed;
      const opens = Number(c.unique_openers) || 0;
      const clicks = Number(c.unique_clickers) || 0;
      return `<tr><td><b>${escapeHtml(c.name)}</b><br><small>${escapeHtml(c.subject)}</small></td><td>${statusPill(c.status)}</td><td>${formatNumber(c.recipient_count)}</td><td>${formatNumber(delivered)}</td><td>${opens ? formatNumber(opens) : '—'}</td><td>${clicks ? formatNumber(clicks) : '—'}</td><td>${formatNumber(failed)}</td><td><div class="rate-cell"><div class="rate-bar"><span style="width:${pct}%;background:${color}"></span></div>${ratePill(rate)}</div></td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

function topLinksPanel(rows = []) {
  if (!rows.length) return '';
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Top clicked links</h2></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Link</th><th>Unique clickers</th><th>Total clicks</th></tr></thead><tbody>${rows
    .map((row) => `<tr><td class="link-cell"><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(row.url)}</a></td><td>${formatNumber(row.clickers)}</td><td>${formatNumber(row.clicks)}</td></tr>`)
    .join('')}</tbody></table></div></section>`;
}

export async function renderReports() {
  const data = await api('/api/reports');
  const totals = data.totals;
  const eng = data.engagement || {};
  const hasSends = totals.attempted > 0 || totals.queued > 0;
  $('#view-root').innerHTML = `<div class="stats-grid">
      <article class="stat-card"><span>Delivered</span><strong>${formatNumber(totals.accepted)}</strong><small>accepted by provider</small></article>
      <article class="stat-card"><span>Delivery rate</span><strong>${percent(totals.deliveryRate)}</strong><small>${formatNumber(totals.attempted)} attempted</small></article>
      <article class="stat-card"><span>Failed</span><strong>${formatNumber(totals.failed)}</strong><small>${formatNumber(totals.bounced)} bounced · ${formatNumber(totals.complained)} complaints</small></article>
      <article class="stat-card"><span>In queue</span><strong>${formatNumber(totals.queued)}</strong><small>awaiting delivery or retry</small></article>
    </div>
    <div class="stats-grid" style="margin-top:16px">
      <article class="stat-card"><span>Open rate</span><strong>${percent(eng.openRate)}</strong><small>${formatNumber(eng.uniqueOpeners || 0)} unique · ${formatNumber(eng.totalOpens || 0)} total</small></article>
      <article class="stat-card"><span>Click rate</span><strong>${percent(eng.clickRate)}</strong><small>${formatNumber(eng.uniqueClickers || 0)} unique · ${formatNumber(eng.totalClicks || 0)} total</small></article>
      <article class="stat-card"><span>Click-to-open</span><strong>${percent(eng.clickToOpenRate)}</strong><small>clickers ÷ openers</small></article>
      <article class="stat-card"><span>Tracked engagement</span><strong>${formatNumber((eng.totalOpens || 0) + (eng.totalClicks || 0))}</strong><small>opens + clicks logged</small></article>
    </div>
    <section class="panel report-chart"><div class="panel-head"><h2>Sends · last ${data.windowDays} days</h2>${chartLegend()}</div>${hasSends ? sendsChart(data.series) : emptyState('No sends in this window yet. The chart fills in as campaigns deliver.')}</section>
    <div class="report-cols wide-left">
      <section class="panel"><div class="panel-head"><h2>Campaign performance</h2></div>${campaignPerformance(data.campaigns)}</section>
      <section class="panel"><div class="panel-head"><h2>Top failure reasons</h2></div>${breakdownList(data.failures, REASON_PALETTE)}</section>
    </div>
    ${topLinksPanel(data.topLinks)}
    <div class="report-cols thirds">
      <section class="panel"><div class="panel-head"><h2>Contacts by status</h2></div>${breakdownList(data.contactsByStatus, STATUS_PALETTE)}</section>
      <section class="panel"><div class="panel-head"><h2>Consent breakdown</h2></div>${breakdownList(data.contactsByConsent, CONSENT_PALETTE)}</section>
      <section class="panel"><div class="panel-head"><h2>Suppressions</h2></div>${breakdownList(data.suppressions, REASON_PALETTE)}</section>
    </div>
    <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Spend &amp; credits</h2></div><div class="report-billing-grid"><div><span>Total spent</span><strong>$${Number(data.billing.spentUsd).toFixed(2)}</strong></div><div><span>Completed orders</span><strong>${formatNumber(data.billing.orders)}</strong></div><div><span>Credits purchased</span><strong>${formatNumber(data.billing.creditsPurchased)}</strong></div></div></section>`;
}
