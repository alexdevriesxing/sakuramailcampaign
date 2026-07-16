import { $, $$, api, config, escapeHtml, formatDate, formatNumber } from './shared.js';
import { alertApp, statusPill } from './dashboard-context.js';

export async function renderBilling() {
  const data = await api('/api/billing');
  const minimum = Number(config.minimumThousands || 5);
  const options = [minimum, 10, 25, 100].filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a - b);
  $('#view-root').innerHTML = `<section class="billing-hero"><div><span>Available balance</span><strong>${formatNumber(data.credits)} emails</strong><p>$1 per 1,000 attempts. No subscription.</p></div><img src="/logo.svg" width="100" alt=""></section><section class="billing-box"><div class="panel-head"><h2>Buy credits</h2><b>PayPal</b></div><div class="credit-options">${options.map((quantity, index) => `<button class="credit-option ${index === 0 ? 'selected' : ''}" data-quantity="${quantity}"><b>${formatNumber(quantity * 1000)} emails</b><span>$${quantity.toFixed(2)}</span></button>`).join('')}</div><div id="paypal-button-container"><button class="button primary" id="load-paypal">Continue with PayPal</button></div><p class="price-note">Payments settle to the PayPal merchant account configured for ${escapeHtml(data.receiverEmail)}. The client ID and secret must belong to that account.</p></section><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Recent orders</h2></div>${data.orders.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Credits</th><th>Amount</th><th>Status</th></tr></thead><tbody>${data.orders.map((order) => `<tr><td>${formatDate(order.created_at)}</td><td>${formatNumber(order.quantity_thousands * 1000)}</td><td>$${escapeHtml(order.amount_usd)}</td><td>${statusPill(order.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-card">No purchases yet.</div>'}</section>`;
  $$('.credit-option').forEach((button) => button.addEventListener('click', () => { $$('.credit-option').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); }));
  $('#load-paypal')?.addEventListener('click', loadPayPal);
}

export async function loadPayPal() {
  const container = $('#paypal-button-container');
  const selected = $('.credit-option.selected');
  const quantityThousands = Number(selected?.dataset.quantity || config.minimumThousands || 5);
  container.innerHTML = '<div class="loading-card">Loading secure PayPal checkout…</div>';
  if (!window.paypal) {
    await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD&intent=capture`; script.onload = resolve; script.onerror = () => reject(new Error('PayPal SDK could not load.')); document.head.append(script); });
  }
  container.innerHTML = '';
  window.paypal.Buttons({
    createOrder: async () => (await api('/api/billing/orders', { method: 'POST', body: JSON.stringify({ quantityThousands }) })).paypalOrderId,
    onApprove: async (data) => { const result = await api('/api/billing/capture', { method: 'POST', body: JSON.stringify({ orderId: data.orderID }) }); alertApp(`${formatNumber(result.creditsAdded)} credits added.`); await renderBilling(); },
    onError: (error) => alertApp(error.message || 'PayPal checkout failed.', 'error'),
  }).render(container);
}

export async function renderSettings() {
  const data = await api('/api/settings');
  $('#view-root').innerHTML = `<form id="settings-form" class="settings-grid"><section class="panel"><div class="panel-head"><h2>Business identity</h2></div><label>Workspace name<input name="workspaceName" value="${escapeHtml(data.workspaceName || '')}" required></label><label>Legal/business name<input name="businessName" value="${escapeHtml(data.businessName || '')}" required></label><label>Physical postal address<textarea name="postalAddress" rows="4" required>${escapeHtml(data.postalAddress || '')}</textarea></label><p class="price-note">Commercial email laws commonly require a valid postal address in every message.</p></section><section class="panel"><div class="panel-head"><h2>Default sender</h2></div><label>From name<input name="defaultFromName" value="${escapeHtml(data.defaultFromName || '')}" required></label><label>From email<input type="email" name="defaultFromEmail" value="${escapeHtml(data.defaultFromEmail || '')}" required></label><label>Reply-to email<input type="email" name="replyToEmail" value="${escapeHtml(data.replyToEmail || '')}"></label><p class="price-note">The from-address domain must be onboarded and authorized in Cloudflare Email Service.</p><button class="button primary" type="submit">Save settings</button></section></form>`;
  $('#settings-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); try { await api('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }); alertApp('Settings saved.'); } catch (error) { alertApp(error.message, 'error'); } });
}

export async function renderAdmin() {
  const data = await api('/api/admin/stats');
  $('#view-root').innerHTML = `<div class="stats-grid"><article class="stat-card"><span>Users</span><strong>${formatNumber(data.users)}</strong></article><article class="stat-card"><span>Workspaces</span><strong>${formatNumber(data.workspaces)}</strong></article><article class="stat-card"><span>Accepted sends</span><strong>${formatNumber(data.acceptedSends)}</strong></article><article class="stat-card"><span>Completed revenue</span><strong>$${Number(data.revenueUsd).toFixed(2)}</strong></article></div><section class="panel" style="margin-top:18px"><h2>Privacy boundary</h2><p>This platform-admin endpoint intentionally returns aggregate operations only. It does not return contact addresses, names, uploaded list data, campaign bodies or attachments.</p></section>`;
}
