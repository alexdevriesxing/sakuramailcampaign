import { $, $$, api, escapeHtml, formatDate, formatNumber } from './shared.js';
import { alertApp, statusPill } from './dashboard-context.js';

export async function renderContacts() {
  const data = await api('/api/contacts');
  $('#view-root').innerHTML = `<div class="toolbar"><div class="left"><button class="button primary" id="add-contact">+ Add contact</button><label class="button ghost">Import CSV<input type="file" id="csv-input" accept=".csv,text/csv" hidden></label></div><div class="right"><span>${formatNumber(data.total)} total</span></div></div>
  <section class="panel"><div class="panel-head"><h2>Recipient list</h2><span>Addresses are masked in the UI</span></div>${data.contacts.length ? `<table class="data-table"><thead><tr><th>Contact</th><th>Consent</th><th>Status</th><th>Added</th></tr></thead><tbody>${data.contacts.map((contact) => `<tr><td><b>${escapeHtml([contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed')}</b><br><small>${escapeHtml(contact.masked_email)}</small></td><td>${escapeHtml(contact.consent_status)}<br><small>${escapeHtml(contact.consent_source || 'No source recorded')}</small></td><td>${statusPill(contact.status)}</td><td>${formatDate(contact.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-card">Import a CSV or add your first contact.</div>'}</section>`;
  $('#add-contact')?.addEventListener('click', () => $('#contact-dialog').showModal());
  $('#csv-input')?.addEventListener('change', importCsv);
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
    const contacts = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || '']))).map((item) => ({ email: item.email || item.email_address, firstName: item.first_name || item.firstname || '', lastName: item.last_name || item.lastname || '', consentStatus: item.consent_status || 'unknown', consentSource: item.consent_source || `CSV import: ${file.name}`, consentAt: item.consent_at || null })).filter((item) => item.email);
    const result = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }); alertApp(`Imported ${result.created}; updated ${result.updated}; rejected ${result.rejected}.`); await renderContacts();
  } catch (error) { alertApp(error.message, 'error'); } finally { event.target.value = ''; }
}

export async function renderFiles() {
  const data = await api('/api/files');
  $('#view-root').innerHTML = `<form id="file-upload-form" class="upload-zone"><b>Upload an attachment</b><p>PDF, images and common office files. Maximum 5 MiB per file; total email size must stay under 5 MiB.</p><input type="file" name="file" required><button class="button primary" type="submit">Upload to R2</button></form><div class="file-grid">${data.files.map((file) => `<article class="file-card"><b>${escapeHtml(file.filename)}</b><span>${escapeHtml(file.content_type)} · ${Math.ceil(file.size_bytes / 1024)} KB</span><div><a class="button text" href="/api/files/${encodeURIComponent(file.id)}">Download</a><button class="button text" data-delete-file="${escapeHtml(file.id)}">Delete</button></div></article>`).join('') || '<div class="empty-card">No uploaded files.</div>'}</div>`;
  $('#file-upload-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const button = $('button', event.currentTarget); button.disabled = true; try { await api('/api/files', { method: 'POST', body: new FormData(event.currentTarget) }); alertApp('File uploaded.'); await renderFiles(); } catch (error) { alertApp(error.message, 'error'); button.disabled = false; } });
  $$('[data-delete-file]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Delete this file?')) return; try { await api(`/api/files/${button.dataset.deleteFile}`, { method: 'DELETE', body: '{}' }); await renderFiles(); } catch (error) { alertApp(error.message, 'error'); } }));
}
