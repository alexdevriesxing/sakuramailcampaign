import { $, $$, api, escapeHtml, formatNumber } from './shared.js';
import { alertApp, appState, campaignTable } from './dashboard-context.js';

export async function renderOverview() {
  const data = await api('/api/dashboard');
  $('#view-root').innerHTML = `<div class="stats-grid">
    <article class="stat-card"><span>Available credits</span><strong>${formatNumber(data.credits)}</strong><small>email attempts</small></article>
    <article class="stat-card"><span>Active contacts</span><strong>${formatNumber(data.activeContacts)}</strong><small>${formatNumber(data.suppressedContacts)} suppressed</small></article>
    <article class="stat-card"><span>Accepted sends</span><strong>${formatNumber(data.acceptedSends)}</strong><small>all time</small></article>
    <article class="stat-card"><span>Scheduled</span><strong>${formatNumber(data.scheduledCampaigns)}</strong><small>campaigns waiting</small></article>
  </div><div class="panel-grid"><section class="panel"><div class="panel-head"><h2>Recent campaigns</h2><button class="button text" data-go="campaigns">View all</button></div>${campaignTable(data.recentCampaigns)}</section>
  <section class="panel"><div class="panel-head"><h2>Compliance readiness</h2></div><p>${data.settingsComplete ? '✓ Sender identity and postal address are complete.' : 'Add your business name, postal address and verified sender before sending.'}</p><button class="button ghost" data-go="settings">Review settings</button></section></div>`;
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sakura:view', { detail: button.dataset.go }))));
}

export async function renderCampaigns() {
  const data = await api('/api/campaigns');
  $('#view-root').innerHTML = `<div class="toolbar"><div class="left"><button class="button primary" id="new-campaign-inline">+ New campaign</button></div><div class="right"><span>${formatNumber(data.campaigns.length)} campaigns</span></div></div>${campaignTable(data.campaigns)}`;
  $('#new-campaign-inline')?.addEventListener('click', openCampaignDialog);
  $$('[data-send]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Reserve credits and queue this campaign for every active contact?')) return;
    button.disabled = true;
    try { const result = await api(`/api/campaigns/${button.dataset.send}/send`, { method: 'POST', body: '{}' }); alertApp(`${formatNumber(result.queued)} messages queued.`); await renderCampaigns(); } catch (error) { alertApp(error.message, 'error'); button.disabled = false; }
  }));
}

export async function openCampaignDialog() {
  const [files, settings] = await Promise.all([api('/api/files'), api('/api/settings')]);
  appState.files = files.files;
  const form = $('#campaign-form');
  form.reset();
  form.elements.fromName.value = settings.defaultFromName || settings.businessName || '';
  form.elements.fromEmail.value = settings.defaultFromEmail || '';
  form.elements.replyTo.value = settings.replyToEmail || '';
  $('#attachment-picker').innerHTML = files.files.length ? `<b>Attachments:</b>${files.files.map((file) => `<label><input type="checkbox" name="attachmentIds" value="${escapeHtml(file.id)}">${escapeHtml(file.filename)} (${Math.ceil(file.size_bytes / 1024)} KB)</label>`).join('')}` : '<span>No files uploaded yet.</span>';
  $('#campaign-dialog').showModal();
}

export async function saveCampaign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const body = {
    name: formData.get('name'), subject: formData.get('subject'), fromName: formData.get('fromName'), fromEmail: formData.get('fromEmail'), replyTo: formData.get('replyTo'), scheduledAt: formData.get('scheduledAt') || null, htmlBody: formData.get('htmlBody'), textBody: formData.get('textBody'), attachmentIds: formData.getAll('attachmentIds'),
  };
  try { await api('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }); $('#campaign-dialog').close(); alertApp('Campaign saved.'); document.dispatchEvent(new CustomEvent('sakura:view', { detail: 'campaigns' })); } catch (error) { alertApp(error.message, 'error'); }
}
