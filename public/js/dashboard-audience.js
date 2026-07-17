import { $, $$, api, escapeHtml, formatDate, formatNumber } from './shared.js';
import { alertApp, statusPill } from './dashboard-context.js';

const contactFilters = { q: '', status: '', consent: '', tagId: '', sortBy: 'created_at', sortDirection: 'desc', page: 1 };

function tagChips(tags = []) {
  return tags.length ? `<div class="tag-list">${tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag.name)}</span>`).join('')}</div>` : '<small>No tags</small>';
}

function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined) params.set(key, String(value)); });
  return params.toString();
}

function suppressionPanel(data) {
  const rows = data.suppressions;
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Suppression list</h2><span data-tip="Anyone on this list is automatically excluded from every campaign.">${formatNumber(data.count)} addresses</span></div>
    <form id="suppress-form" class="inline-form"><input type="email" name="email" placeholder="Manually suppress an address" required><button class="button ghost" type="submit">Suppress</button></form>
    ${rows.length ? `<div class="table-scroll" style="margin-top:12px"><table class="data-table"><thead><tr><th>Address</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>${rows
      .map((row) => `<tr><td>${escapeHtml(row.email)}</td><td>${statusPill(row.reason)}</td><td>${formatDate(row.createdAt)}</td><td>${row.removable ? `<button class="button text" data-unsuppress="${escapeHtml(row.emailHash)}">Remove</button>` : '<small data-tip="Unsubscribes and complaints are permanent. The person must opt in again themselves.">Permanent</small>'}</td></tr>`)
      .join('')}</tbody></table></div>` : '<div class="empty-card small" style="margin-top:12px">Nobody is suppressed yet. Unsubscribes and hard bounces land here automatically.</div>'}</section>`;
}

export async function renderContacts() {
  const [tagData, data, suppressionData] = await Promise.all([
    api('/api/tags'),
    api(`/api/contacts?${queryString(contactFilters)}`),
    api('/api/suppressions'),
  ]);
  const tagOptions = tagData.tags.map((tag) => `<option value="${escapeHtml(tag.id)}" ${contactFilters.tagId === tag.id ? 'selected' : ''}>${escapeHtml(tag.name)} (${formatNumber(tag.contact_count)})</option>`).join('');
  $('#view-root').innerHTML = `<div class="toolbar"><div class="left"><button class="button primary" id="add-contact">+ Add contact</button><label class="button ghost">Import CSV<input type="file" id="csv-input" accept=".csv,text/csv" hidden></label></div><div class="right"><span>${formatNumber(data.total)} matching · ${formatNumber(data.workspaceTotal)} total</span></div></div>
  <form id="contact-filter" class="filter-bar"><input name="q" value="${escapeHtml(contactFilters.q)}" placeholder="Search name or exact email"><select name="status"><option value="">All statuses</option>${['active','unsubscribed','bounced','complained'].map((value) => `<option value="${value}" ${contactFilters.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select><select name="consent"><option value="">All consent types</option>${['express','implied','transactional','unknown'].map((value) => `<option value="${value}" ${contactFilters.consent === value ? 'selected' : ''}>${value}</option>`).join('')}</select><select name="tagId"><option value="">All tags</option>${tagOptions}</select><select name="sortBy">${[['created_at','Date added'],['first_name','First name'],['last_name','Last name'],['consent_status','Consent'],['status','Status']].map(([value,label]) => `<option value="${value}" ${contactFilters.sortBy === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select name="sortDirection"><option value="desc" ${contactFilters.sortDirection === 'desc' ? 'selected' : ''}>Descending</option><option value="asc" ${contactFilters.sortDirection === 'asc' ? 'selected' : ''}>Ascending</option></select><button class="button ghost" type="submit">Apply</button><button class="button text" type="button" id="clear-contact-filters">Clear</button></form>
  <div class="bulk-bar"><span id="selected-count">0 selected</span><select id="bulk-tag"><option value="">Choose tag</option>${tagData.tags.map((tag) => `<option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>`).join('')}</select><button class="button ghost" id="bulk-add-tag">Add tag</button><button class="button text" id="bulk-remove-tag">Remove tag</button><button class="button text danger" id="bulk-delete" data-tip="Permanently erase the selected contacts. Their unsubscribe/bounce record is kept so they can never be accidentally re-mailed.">Delete selected</button></div>
  <section class="panel"><div class="panel-head"><h2>Recipient database</h2><span>Addresses are masked in the UI</span></div>${data.contacts.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th><input type="checkbox" id="select-all-contacts" aria-label="Select all shown contacts"></th><th>Contact</th><th>Tags</th><th>Consent</th><th>Status</th><th>Added</th></tr></thead><tbody>${data.contacts.map((contact) => `<tr><td><input type="checkbox" class="contact-select" value="${escapeHtml(contact.id)}" aria-label="Select contact"></td><td><b>${escapeHtml([contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed')}</b><br><small>${escapeHtml(contact.masked_email)}</small></td><td>${tagChips(contact.tags)}</td><td>${escapeHtml(contact.consent_status)}<br><small>${escapeHtml(contact.consent_source || 'No source recorded')}</small></td><td>${statusPill(contact.status)}${contact.suppressed ? ' <span class="status-pill unsubscribed" data-tip="On the suppression list — excluded from every campaign.">suppressed</span>' : ''}</td><td>${formatDate(contact.created_at)}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><button class="button text" id="contacts-prev" ${data.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${data.page} of ${data.pages}</span><button class="button text" id="contacts-next" ${data.page >= data.pages ? 'disabled' : ''}>Next →</button></div>` : '<div class="empty-card">No contacts match these filters.</div>'}</section>${suppressionPanel(suppressionData)}`;

  $('#suppress-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    try { await api('/api/suppressions', { method: 'POST', body: JSON.stringify({ email }) }); alertApp(`${email} will be excluded from all future campaigns.`); await renderContacts(); } catch (error) { alertApp(error.message, 'error'); }
  });
  $$('[data-unsuppress]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Remove this address from the suppression list? Only do this if you are certain they want your email.')) return;
    try { await api(`/api/suppressions/${encodeURIComponent(button.dataset.unsuppress)}`, { method: 'DELETE', body: '{}' }); alertApp('Suppression removed.'); await renderContacts(); } catch (error) { alertApp(error.message, 'error'); }
  }));
  $('#add-contact')?.addEventListener('click', () => $('#contact-dialog').showModal());
  $('#csv-input')?.addEventListener('change', importCsv);
  $('#contact-filter')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    Object.assign(contactFilters, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 });
    await renderContacts();
  });
  $('#clear-contact-filters')?.addEventListener('click', async () => {
    Object.assign(contactFilters, { q: '', status: '', consent: '', tagId: '', sortBy: 'created_at', sortDirection: 'desc', page: 1 });
    await renderContacts();
  });
  $('#contacts-prev')?.addEventListener('click', async () => { contactFilters.page = Math.max(1, data.page - 1); await renderContacts(); });
  $('#contacts-next')?.addEventListener('click', async () => { contactFilters.page = Math.min(data.pages, data.page + 1); await renderContacts(); });
  $('#select-all-contacts')?.addEventListener('change', (event) => { $$('.contact-select').forEach((box) => { box.checked = event.currentTarget.checked; }); updateSelectedCount(); });
  $$('.contact-select').forEach((box) => box.addEventListener('change', updateSelectedCount));
  $('#bulk-add-tag')?.addEventListener('click', () => applyBulkTag('add'));
  $('#bulk-remove-tag')?.addEventListener('click', () => applyBulkTag('remove'));
  $('#bulk-delete')?.addEventListener('click', deleteSelectedContacts);
}

async function deleteSelectedContacts() {
  const contactIds = $$('.contact-select:checked').map((box) => box.value);
  if (!contactIds.length) return alertApp('Select the contacts you want to delete first.', 'error');
  if (!confirm(`Permanently erase ${contactIds.length} contact(s)? This cannot be undone. Any unsubscribe or bounce record is kept so they are never accidentally re-mailed.`)) return;
  try {
    const result = await api('/api/contacts/delete', { method: 'POST', body: JSON.stringify({ contactIds }) });
    alertApp(`${formatNumber(result.deleted)} contact(s) erased.`);
    await renderContacts();
  } catch (error) { alertApp(error.message, 'error'); }
}

function updateSelectedCount() {
  const count = $$('.contact-select:checked').length;
  if ($('#selected-count')) $('#selected-count').textContent = `${count} selected`;
}

async function applyBulkTag(action) {
  const contactIds = $$('.contact-select:checked').map((box) => box.value);
  const tagId = $('#bulk-tag')?.value;
  if (!contactIds.length || !tagId) return alertApp('Select contacts and a tag first.', 'error');
  const body = { contactIds, addTagIds: action === 'add' ? [tagId] : [], removeTagIds: action === 'remove' ? [tagId] : [] };
  try {
    const result = await api('/api/contacts/tags', { method: 'PATCH', body: JSON.stringify(body) });
    alertApp(`Updated ${formatNumber(result.updated)} contacts.`);
    await renderContacts();
  } catch (error) { alertApp(error.message, 'error'); }
}

export async function saveContact(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try { await api('/api/contacts', { method: 'POST', body: JSON.stringify(data) }); $('#contact-dialog').close(); event.currentTarget.reset(); alertApp('Contact added.'); await renderContacts(); } catch (error) { alertApp(error.message, 'error'); }
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) { const char = text[i]; const next = text[i + 1]; if (quoted && char === '"' && next === '"') { field += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { row.push(field); field = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = ''; } else field += char; }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row); return rows;
}

export async function importCsv(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const rows = parseCsv(await file.text()); if (rows.length < 2) throw new Error('CSV needs a header row and at least one contact.');
    const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    const contacts = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || '']))).map((item) => ({ email: item.email || item.email_address, firstName: item.first_name || item.firstname || '', lastName: item.last_name || item.lastname || '', consentStatus: item.consent_status || 'unknown', consentSource: item.consent_source || `CSV import: ${file.name}`, consentAt: item.consent_at || null, tags: item.tags || item.tag || '' })).filter((item) => item.email);
    const result = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }); alertApp(`Imported ${result.created}; updated ${result.updated}; rejected ${result.rejected}.`); await renderContacts();
  } catch (error) { alertApp(error.message, 'error'); } finally { event.target.value = ''; }
}

function optionList(tags, selected = []) {
  return tags.map((tag) => `<option value="${escapeHtml(tag.id)}" ${selected.includes(tag.id) ? 'selected' : ''}>${escapeHtml(tag.name)} (${formatNumber(tag.contact_count)})</option>`).join('');
}

function ruleSummary(rules, tagsById) {
  const parts = [];
  if (rules.tagIds?.length) parts.push(`${rules.tagMode === 'all' ? 'all' : 'any'} of ${rules.tagIds.map((id) => tagsById.get(id) || 'deleted tag').join(', ')}`);
  if (rules.excludeTagIds?.length) parts.push(`excluding ${rules.excludeTagIds.map((id) => tagsById.get(id) || 'deleted tag').join(', ')}`);
  if (rules.consentStatuses?.length) parts.push(`consent: ${rules.consentStatuses.join(', ')}`);
  if (rules.createdAfter) parts.push(`added after ${formatDate(rules.createdAfter)}`);
  if (rules.createdBefore) parts.push(`added before ${formatDate(rules.createdBefore)}`);
  if (rules.hasName === true) parts.push('has a name');
  if (rules.hasName === false) parts.push('has no name');
  parts.push(`sorted by ${String(rules.sortBy || 'created_at').replace('_', ' ')} ${rules.sortDirection || 'desc'}`);
  if (rules.maxRecipients) parts.push(`maximum ${formatNumber(rules.maxRecipients)}`);
  return parts.join(' · ');
}

export async function renderSegments() {
  const [tagData, segmentData] = await Promise.all([api('/api/tags'), api('/api/segments')]);
  const tagsById = new Map(tagData.tags.map((tag) => [tag.id, tag.name]));
  $('#view-root').innerHTML = `<div class="segment-layout"><section class="panel"><div class="panel-head"><h2>Create a saved segment</h2><span>Only active, unsuppressed contacts can receive campaigns</span></div><form id="segment-form"><div class="form-grid"><label>Segment name<input name="name" required maxlength="120" placeholder="VIP customers"></label><label>Description<input name="description" maxlength="500" placeholder="High-value customers for launches"></label><label>Include tags<select name="tagIds" multiple size="6">${optionList(tagData.tags)}</select></label><label>Tag matching<select name="tagMode"><option value="any">Match any selected tag</option><option value="all">Match every selected tag</option></select></label><label>Exclude tags<select name="excludeTagIds" multiple size="6">${optionList(tagData.tags)}</select></label><label>Consent types<select name="consentStatuses" multiple size="4">${['express','implied','transactional','unknown'].map((value) => `<option value="${value}">${value}</option>`).join('')}</select></label><label>Added after<input type="date" name="createdAfter"></label><label>Added before<input type="date" name="createdBefore"></label><label>Name filter<select name="hasName"><option value="">Any</option><option value="true">Has a first or last name</option><option value="false">No name recorded</option></select></label><label>Sort by<select name="sortBy"><option value="created_at">Date added</option><option value="first_name">First name</option><option value="last_name">Last name</option><option value="consent_status">Consent status</option></select></label><label>Direction<select name="sortDirection"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label><label>Maximum recipients<input type="number" name="maxRecipients" min="1" max="100000" placeholder="No limit"></label></div><button class="button primary" type="submit">Save segment</button></form></section>
  <section><div class="panel"><div class="panel-head"><h2>Tags</h2><span>${formatNumber(tagData.tags.length)} tags</span></div><form id="tag-form" class="inline-form"><input name="name" maxlength="40" placeholder="Create a tag" required><button class="button ghost" type="submit">Add</button></form><div class="tag-manager">${tagData.tags.map((tag) => `<div><span class="tag-chip">${escapeHtml(tag.name)}</span><small>${formatNumber(tag.contact_count)} contacts</small><button class="button text" data-delete-tag="${escapeHtml(tag.id)}">Delete</button></div>`).join('') || '<p class="price-note">Tags are also created automatically during contact import.</p>'}</div></section></div></div>
  <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Saved segments</h2><span>${formatNumber(segmentData.segments.length)} segments</span></div><div class="segment-grid">${segmentData.segments.map((segment) => `<article class="segment-card"><div><b>${escapeHtml(segment.name)}</b><span>${formatNumber(segment.count)} recipients</span></div><p>${escapeHtml(segment.description || 'No description')}</p><small>${escapeHtml(ruleSummary(segment.rules, tagsById))}</small><button class="button text" data-delete-segment="${escapeHtml(segment.id)}">Delete</button></article>`).join('') || '<div class="empty-card">Create a segment to target campaigns by tags, consent, dates, names, sorting or a recipient cap.</div>'}</div></section>`;

  $('#segment-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const hasNameValue = data.get('hasName');
    const rules = { tagIds: data.getAll('tagIds'), tagMode: data.get('tagMode'), excludeTagIds: data.getAll('excludeTagIds'), consentStatuses: data.getAll('consentStatuses'), createdAfter: data.get('createdAfter') || null, createdBefore: data.get('createdBefore') || null, hasName: hasNameValue === 'true' ? true : hasNameValue === 'false' ? false : null, sortBy: data.get('sortBy'), sortDirection: data.get('sortDirection'), maxRecipients: data.get('maxRecipients') ? Number(data.get('maxRecipients')) : null };
    try { const result = await api('/api/segments', { method: 'POST', body: JSON.stringify({ name: data.get('name'), description: data.get('description'), rules }) }); alertApp(`Segment saved with ${formatNumber(result.count)} recipients.`); await renderSegments(); } catch (error) { alertApp(error.message, 'error'); }
  });
  $('#tag-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api('/api/tags', { method: 'POST', body: JSON.stringify(data) }); alertApp('Tag created.'); await renderSegments(); } catch (error) { alertApp(error.message, 'error'); } });
  $$('[data-delete-tag]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Delete this tag from every contact? Saved segments using it will stop matching it.')) return; try { await api(`/api/tags/${button.dataset.deleteTag}`, { method: 'DELETE', body: '{}' }); alertApp('Tag deleted.'); await renderSegments(); } catch (error) { alertApp(error.message, 'error'); } }));
  $$('[data-delete-segment]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Delete this saved segment? Existing campaigns keep their audience snapshot.')) return; try { await api(`/api/segments/${button.dataset.deleteSegment}`, { method: 'DELETE', body: '{}' }); alertApp('Segment deleted.'); await renderSegments(); } catch (error) { alertApp(error.message, 'error'); } }));
}

export async function renderFiles() {
  const data = await api('/api/files');
  $('#view-root').innerHTML = `<form id="file-upload-form" class="upload-zone"><b>Upload an attachment</b><p>PDF, images and common office files. Maximum 5 MiB per file; total email size must stay under 5 MiB.</p><input type="file" name="file" required><button class="button primary" type="submit">Upload to R2</button></form><div class="file-grid">${data.files.map((file) => `<article class="file-card"><b>${escapeHtml(file.filename)}</b><span>${escapeHtml(file.content_type)} · ${Math.ceil(file.size_bytes / 1024)} KB</span><div><a class="button text" href="/api/files/${encodeURIComponent(file.id)}">Download</a><button class="button text" data-delete-file="${escapeHtml(file.id)}">Delete</button></div></article>`).join('') || '<div class="empty-card">No uploaded files.</div>'}</div>`;
  $('#file-upload-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const button = $('button', event.currentTarget); button.disabled = true; try { await api('/api/files', { method: 'POST', body: new FormData(event.currentTarget) }); alertApp('File uploaded.'); await renderFiles(); } catch (error) { alertApp(error.message, 'error'); button.disabled = false; } });
  $$('[data-delete-file]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Delete this file?')) return; try { await api(`/api/files/${button.dataset.deleteFile}`, { method: 'DELETE', body: '{}' }); await renderFiles(); } catch (error) { alertApp(error.message, 'error'); } }));
}
