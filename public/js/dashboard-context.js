import { $, escapeHtml, formatDate, formatNumber } from './shared.js';

export const appState = { me: null, currentView: 'overview', files: [], senders: [], segments: [] };

export function alertApp(message, type = 'success') {
  const element = $('#app-alert');
  if (!element) return;
  element.textContent = message;
  element.className = `app-alert ${type}`;
  element.hidden = false;
  setTimeout(() => { element.hidden = true; }, 6000);
}

export function statusPill(status) {
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

export function campaignTable(campaigns = []) {
  if (!campaigns.length) return '<div class="empty-card">No campaigns yet.</div>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Name</th><th>Sender / audience</th><th>Status</th><th>Recipients</th><th>Schedule</th><th></th></tr></thead><tbody>${campaigns.map((campaign) => `<tr><td><b>${escapeHtml(campaign.name)}</b><br><small>${escapeHtml(campaign.subject)}</small></td><td><b>${escapeHtml(campaign.sender_label || campaign.from_name || 'Sender')}</b><br><small>${escapeHtml(campaign.segment_name || 'All active contacts')}</small></td><td>${statusPill(campaign.status)}</td><td>${formatNumber(campaign.recipient_count)}</td><td>${formatDate(campaign.scheduled_at || campaign.sent_at)}</td><td>${['draft','scheduled','failed'].includes(campaign.status) ? `<button class="button text" data-test="${escapeHtml(campaign.id)}">Test</button> <button class="button text" data-send="${escapeHtml(campaign.id)}">Send</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
