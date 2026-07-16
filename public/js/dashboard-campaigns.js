import { $, $$, api, escapeHtml, formatNumber } from './shared.js';
import { alertApp, appState, campaignTable } from './dashboard-context.js';

export async function renderOverview() {
  const data = await api('/api/dashboard');
  $('#view-root').innerHTML = `<div class="stats-grid">
    <article class="stat-card"><span>Available credits</span><strong>${formatNumber(data.credits)}</strong><small>email attempts</small></article>
    <article class="stat-card"><span>Active contacts</span><strong>${formatNumber(data.activeContacts)}</strong><small>${formatNumber(data.suppressedContacts)} suppressed</small></article>
    <article class="stat-card"><span>Delivered sends</span><strong>${formatNumber(data.acceptedSends)}</strong><small>${data.deliveryRate == null ? 'all time' : `${Math.round(data.deliveryRate * 100)}% delivery rate`}</small></article>
    <article class="stat-card"><span>Scheduled</span><strong>${formatNumber(data.scheduledCampaigns)}</strong><small>campaigns waiting</small></article>
  </div><div class="panel-grid"><section class="panel"><div class="panel-head"><h2>Recent campaigns</h2><div class="panel-head-actions"><button class="button text" data-go="reports">Reports</button><button class="button text" data-go="campaigns">View all</button></div></div>${campaignTable(data.recentCampaigns)}</section>
  <section class="panel"><div class="panel-head"><h2>Compliance readiness</h2></div><p>${data.settingsComplete ? '✓ Business identity, postal address and an active sender are ready.' : 'Add your business identity, postal address and at least one active sender before sending.'}</p><button class="button ghost" data-go="settings">Review settings</button></section></div>`;
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sakura:view', { detail: button.dataset.go }))));
}

export async function renderCampaigns() {
  const data = await api('/api/campaigns');
  $('#view-root').innerHTML = `<div class="toolbar"><div class="left"><button class="button primary" id="new-campaign-inline">+ New campaign</button></div><div class="right"><span>${formatNumber(data.campaigns.length)} campaigns</span></div></div>${campaignTable(data.campaigns)}`;
  $('#new-campaign-inline')?.addEventListener('click', openCampaignDialog);
  $$('[data-test]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { const result = await api(`/api/campaigns/${button.dataset.test}/test`, { method: 'POST', body: '{}' }); alertApp(`Test email sent to ${result.sentTo}.`); } catch (error) { alertApp(error.message, 'error'); } finally { button.disabled = false; }
  }));
  $$('[data-send]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Reserve credits and queue this campaign for its saved audience?')) return;
    button.disabled = true;
    try { const result = await api(`/api/campaigns/${button.dataset.send}/send`, { method: 'POST', body: '{}' }); alertApp(`${formatNumber(result.queued)} messages queued.`); await renderCampaigns(); } catch (error) { alertApp(error.message, 'error'); button.disabled = false; }
  }));
}

function syncSenderDefaults() {
  const form = $('#campaign-form');
  const sender = appState.senders.find((item) => item.id === form.elements.senderId.value);
  if (!sender) return;
  form.elements.fromName.value = sender.fromName || '';
  form.elements.replyTo.value = sender.replyTo || '';
}

function syncAudienceEstimate() {
  const form = $('#campaign-form');
  const segmentId = form.elements.segmentId.value;
  const segment = appState.segments.find((item) => item.id === segmentId);
  $('#audience-estimate').textContent = segment
    ? `${formatNumber(segment.count)} active, unsuppressed contacts currently match “${segment.name}”. The rules are snapshotted when you save.`
    : 'All active, unsuppressed contacts will be selected when the campaign sends.';
}

function renderTemplatePicker() {
  const select = $('#template-pick');
  select.innerHTML = `<option value="">Blank campaign</option>${(appState.templates || []).map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('')}`;
  $('#delete-template').hidden = true;
}

function applyTemplate(event) {
  const template = (appState.templates || []).find((item) => item.id === event.target.value);
  $('#delete-template').hidden = !template;
  if (!template) return;
  const form = $('#campaign-form');
  if (template.subject) form.elements.subject.value = template.subject;
  form.elements.preheader.value = template.preheader || '';
  form.elements.htmlBody.value = template.htmlBody || '';
  form.elements.textBody.value = template.textBody || '';
}

async function saveAsTemplate() {
  const form = $('#campaign-form');
  if (!form.elements.htmlBody.value.trim()) { alertApp('Add HTML content before saving a template.', 'error'); return; }
  const name = prompt('Template name', form.elements.name.value || 'My template');
  if (!name) return;
  try {
    await api('/api/templates', { method: 'POST', body: JSON.stringify({ name, subject: form.elements.subject.value, preheader: form.elements.preheader.value, htmlBody: form.elements.htmlBody.value, textBody: form.elements.textBody.value }) });
    appState.templates = (await api('/api/templates')).templates;
    renderTemplatePicker();
    alertApp('Template saved.');
  } catch (error) { alertApp(error.message, 'error'); }
}

async function deleteTemplate() {
  const id = $('#template-pick').value;
  if (!id || !confirm('Delete this template? Campaigns already created are unaffected.')) return;
  try {
    await api(`/api/templates/${id}`, { method: 'DELETE', body: '{}' });
    appState.templates = (await api('/api/templates')).templates;
    renderTemplatePicker();
    alertApp('Template deleted.');
  } catch (error) { alertApp(error.message, 'error'); }
}

function openPreview() {
  const form = $('#campaign-form');
  const host = $('#preview-host');
  $('#preview-subject').textContent = form.elements.subject.value || '(no subject)';
  $('#preview-preheader').textContent = form.elements.preheader.value || 'No preview text';
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
  // Shadow DOM isolates the message styles from the app; innerHTML never executes scripts.
  shadow.innerHTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;padding:18px;line-height:1.5">${form.elements.htmlBody.value || '<p style="color:#999">No HTML content yet.</p>'}</div>`;
  $('#preview-close').onclick = () => $('#preview-dialog').close();
  $$('#preview-dialog [data-device]').forEach((button) => { button.onclick = () => { host.className = `preview-host ${button.dataset.device}`; }; });
  $('#preview-dialog').showModal();
}

export async function openCampaignDialog() {
  const [files, senderData, segmentData, templateData] = await Promise.all([api('/api/files'), api('/api/senders'), api('/api/segments'), api('/api/templates')]);
  appState.files = files.files;
  appState.senders = senderData.senders.filter((sender) => sender.status === 'active');
  appState.segments = segmentData.segments;
  appState.templates = templateData.templates;
  if (!appState.senders.length) {
    alertApp('Add an active sender identity in Settings before creating a campaign.', 'error');
    document.dispatchEvent(new CustomEvent('sakura:view', { detail: 'settings' }));
    return;
  }
  const form = $('#campaign-form');
  form.reset();
  form.elements.senderId.innerHTML = appState.senders.map((sender) => `<option value="${escapeHtml(sender.id)}" ${sender.isDefault ? 'selected' : ''}>${escapeHtml(sender.label)} — ${escapeHtml(sender.email)}</option>`).join('');
  form.elements.segmentId.innerHTML = `<option value="">All active contacts</option>${appState.segments.map((segment) => `<option value="${escapeHtml(segment.id)}">${escapeHtml(segment.name)} (${formatNumber(segment.count)})</option>`).join('')}`;
  renderTemplatePicker();
  syncSenderDefaults();
  syncAudienceEstimate();
  form.elements.senderId.onchange = syncSenderDefaults;
  form.elements.segmentId.onchange = syncAudienceEstimate;
  $('#template-pick').onchange = applyTemplate;
  $('#save-template').onclick = saveAsTemplate;
  $('#delete-template').onclick = deleteTemplate;
  $('#preview-campaign').onclick = openPreview;
  $('#attachment-picker').innerHTML = files.files.length ? `<b>Attachments:</b>${files.files.map((file) => `<label><input type="checkbox" name="attachmentIds" value="${escapeHtml(file.id)}">${escapeHtml(file.filename)} (${Math.ceil(file.size_bytes / 1024)} KB)</label>`).join('')}` : '<span>No files uploaded yet.</span>';
  $('#campaign-dialog').showModal();
}

export async function saveCampaign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const body = {
    name: formData.get('name'),
    subject: formData.get('subject'),
    senderId: formData.get('senderId'),
    fromName: formData.get('fromName'),
    replyTo: formData.get('replyTo'),
    segmentId: formData.get('segmentId') || null,
    scheduledAt: formData.get('scheduledAt') || null,
    htmlBody: formData.get('htmlBody'),
    textBody: formData.get('textBody'),
    preheader: formData.get('preheader'),
    attachmentIds: formData.getAll('attachmentIds'),
    trackOpens: formData.get('trackOpens') === 'on',
    trackClicks: formData.get('trackClicks') === 'on',
  };
  try {
    const result = await api('/api/campaigns', { method: 'POST', body: JSON.stringify(body) });
    $('#campaign-dialog').close();
    alertApp(`Campaign saved for an estimated ${formatNumber(result.estimatedRecipients)} recipients.`);
    document.dispatchEvent(new CustomEvent('sakura:view', { detail: 'campaigns' }));
  } catch (error) { alertApp(error.message, 'error'); }
}
