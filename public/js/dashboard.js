import { $, $$, api } from './shared.js';
import { appState } from './dashboard-context.js';
import { openCampaignDialog, renderCampaigns, renderOverview, saveCampaign } from './dashboard-campaigns.js';
import { renderContacts, renderFiles, renderSegments, saveContact } from './dashboard-audience.js';
import { renderAdmin, renderBilling, renderSettings } from './dashboard-billing.js';

export async function initApp() {
  const root = $('#view-root');
  if (!root) return;
  try {
    appState.me = await api('/api/me');
  } catch {
    window.location.assign('/login');
    return;
  }
  $('#sidebar-email').textContent = appState.me.email;
  $('#admin-nav').hidden = !appState.me.isPlatformAdmin;

  $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-action="new-campaign"]').forEach((button) => button.addEventListener('click', openCampaignDialog));
  $('#logout-button')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); window.location.assign('/'); });
  $('#mobile-menu')?.addEventListener('click', () => $('.sidebar')?.classList.toggle('open'));
  $('#campaign-form')?.addEventListener('submit', saveCampaign);
  $('#contact-form')?.addEventListener('submit', saveContact);
  document.addEventListener('sakura:view', (event) => switchView(event.detail));
  await switchView('overview');
}

async function switchView(view) {
  appState.currentView = view;
  $$('.sidebar [data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('.sidebar')?.classList.remove('open');
  const titles = {
    overview: ['Overview', 'Your campaign workspace at a glance.'], campaigns: ['Campaigns', 'Compose, schedule and monitor mailings.'], contacts: ['Contacts', 'Encrypted recipients, tags and consent records.'], segments: ['Segments', 'Saved audiences built from tags, consent, dates and sorting.'], files: ['Files', 'Attachments stored in Cloudflare R2.'], billing: ['Billing', 'Prepaid credits with transparent pricing.'], settings: ['Settings', 'Sender identity and compliance details.'], admin: ['Platform admin', 'Operational totals without recipient-list access.'],
  };
  $('#view-title').textContent = titles[view]?.[0] || view;
  $('#view-subtitle').textContent = titles[view]?.[1] || '';
  $('#view-root').innerHTML = '<div class="loading-card">Loading…</div>';
  try {
    const renderers = { overview: renderOverview, campaigns: renderCampaigns, contacts: renderContacts, segments: renderSegments, files: renderFiles, billing: renderBilling, settings: renderSettings, admin: renderAdmin };
    const renderer = renderers[view];
    if (!renderer) throw new Error('Unknown view.');
    await renderer();
  } catch (error) {
    $('#view-root').innerHTML = `<div class="empty-card">${String(error?.message || error)}</div>`;
  }
}
