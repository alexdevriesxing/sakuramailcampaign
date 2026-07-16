import type { Env } from '../types';
import { escapeHtml } from '../security';
import { logo, page } from './shared';

export function landingPage(env: Env): string {
  const body = `
<header class="site-header">
  <div class="container nav-wrap">${logo}
    <nav aria-label="Main navigation">
      <a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
    </nav>
    <div class="nav-actions"><a class="button ghost" href="/login">Sign in</a><a class="button primary" href="/login">Start sending</a></div>
  </div>
</header>
<main>
  <section class="hero">
    <div class="petal petal-one"></div><div class="petal petal-two"></div>
    <div class="container hero-grid">
      <div>
        <div class="eyebrow">Cloudflare-powered email campaigns</div>
        <h1>Beautiful mailings.<br><span>One honest price.</span></h1>
        <p class="hero-copy">Compose, import, schedule and send without a bloated monthly plan. Sakura Mail gives every account an isolated workspace, encrypted contact storage and transparent pay-as-you-go credits.</p>
        <div class="hero-actions"><a class="button primary large" href="/login">Create your workspace</a><a class="button text" href="#pricing">See transparent pricing →</a></div>
        <div class="trust-row"><span>✓ No subscription</span><span>✓ Automatic unsubscribe</span><span>✓ PayPal checkout</span></div>
      </div>
      <div class="hero-card" aria-label="Campaign dashboard preview">
        <div class="browser-bar"><i></i><i></i><i></i><span>mail.sakurasoftwaresolutions.com</span></div>
        <div class="preview-shell">
          <aside><img src="/logo.svg" alt=""><b>Sakura Mail</b><span class="active">Overview</span><span>Campaigns</span><span>Contacts</span><span>Files</span><span>Billing</span></aside>
          <div class="preview-main"><div class="preview-top"><div><small>Available balance</small><strong>24,000 emails</strong></div><button>New campaign</button></div>
            <div class="metric-row"><div><small>Sent</small><b>8,492</b><em>this month</em></div><div><small>Active contacts</small><b>3,204</b><em>consent tracked</em></div><div><small>Next send</small><b>Fri 9:00</b><em>scheduled</em></div></div>
            <div class="campaign-preview"><div class="subject-line"><span class="status-dot"></span><div><b>Spring product update</b><small>Scheduled for Friday · 3,204 recipients</small></div><strong>$3.20</strong></div><div class="progress"><i></i></div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="logo-strip"><div class="container"><span>Built on</span><b>Cloudflare Workers</b><b>D1</b><b>R2</b><b>Queues</b><b>Email Service</b></div></section>

  <section id="how" class="section">
    <div class="container"><div class="section-heading"><div class="eyebrow">A calmer workflow</div><h2>From idea to inbox in four steps</h2><p>No complicated tiers, contact-count penalties or hidden feature gates.</p></div>
      <div class="steps">
        <article><span>01</span><div class="icon-card">✦</div><h3>Compose</h3><p>Write responsive HTML and plain-text versions, personalize with merge fields and attach files stored in R2.</p></article>
        <article><span>02</span><div class="icon-card">⌁</div><h3>Import</h3><p>Upload CSV, paste a list or add contacts manually. Consent source and timestamp travel with each contact.</p></article>
        <article><span>03</span><div class="icon-card">◷</div><h3>Schedule</h3><p>Send now or choose a future time. Queues fan out safely, while suppression checks happen immediately before delivery.</p></article>
        <article><span>04</span><div class="icon-card">✓</div><h3>Measure</h3><p>Track accepted and failed sends, manage unsubscribes and keep a clean audit trail without exposing recipient addresses to admins.</p></article>
      </div>
    </div>
  </section>

  <section id="privacy" class="section privacy-section">
    <div class="container privacy-grid">
      <div class="privacy-visual"><div class="shield"><img src="/logo.svg" alt=""><span>Encrypted at rest</span></div><div class="data-chip chip-a">recipient@••••</div><div class="data-chip chip-b">AES-256-GCM</div><div class="data-chip chip-c">tenant scoped</div></div>
      <div><div class="eyebrow">Privacy by architecture</div><h2>Your audience is not our product.</h2><p>Contact addresses are encrypted before storage. Every application query is scoped to the signed-in workspace, platform-admin reports exclude contact addresses and campaign content, and access-sensitive actions are recorded in an audit log.</p>
        <div class="principles"><div><b>We do not sell or rent data</b><span>Your lists are processed only to provide the service and meet legal obligations.</span></div><div><b>Just-in-time decryption</b><span>The sending Worker decrypts one recipient only when that message is being prepared.</span></div><div><b>Honest limitation</b><span>Scheduled sending cannot be fully “zero knowledge”; authorized application code must briefly process the address. Operator access is restricted, not magically impossible.</span></div></div>
        <a class="inline-link" href="/privacy">Read the privacy policy →</a>
      </div>
    </div>
  </section>

  <section id="pricing" class="section pricing-section">
    <div class="container"><div class="section-heading"><div class="eyebrow">Transparent pricing</div><h2>$1 per 1,000 email attempts</h2><p>Buy credits when you need them. Credits do not expire while your account remains active.</p></div>
      <div class="pricing-card"><div class="price-main"><span>$</span><strong>1</strong><div><b>per 1,000</b><small>email delivery attempts</small></div></div>
        <ul><li>No monthly subscription</li><li>All product features included</li><li>Secure PayPal checkout</li><li>Minimum purchase: $${escapeHtml(env.MIN_PURCHASE_THOUSANDS)} for ${Number(env.MIN_PURCHASE_THOUSANDS).toLocaleString()},000 credits</li></ul>
        <a class="button primary large" href="/login">Get started</a>
        <p class="price-note">An attempt counts when accepted into the sending pipeline, including a later bounce, because the upstream provider charges for accepted sends. PayPal processing, Workers, storage and database costs are absorbed by Sakura Mail. Taxes may apply.</p>
      </div>
      <div class="cost-example"><b>Example</b><span>12,500 recipients</span><span>13,000 credits reserved</span><strong>$13.00</strong></div>
    </div>
  </section>

  <section class="section feature-section"><div class="container"><div class="section-heading"><div class="eyebrow">Everything essential</div><h2>Small price. Serious controls.</h2></div>
    <div class="feature-grid"><article><b>CSV + paste import</b><p>Normalize, deduplicate and validate before addresses enter your workspace.</p></article><article><b>Attachment library</b><p>Store approved images and files in R2 with size and type controls.</p></article><article><b>Consent records</b><p>Keep source, status and timestamp alongside every contact.</p></article><article><b>Suppression enforcement</b><p>Unsubscribed, bounced and complained addresses are blocked at send time.</p></article><article><b>Tenant isolation</b><p>Workspace IDs are enforced in every data path, including files and billing.</p></article><article><b>Admin without list access</b><p>Platform analytics show operations and revenue, not recipient addresses or content.</p></article></div>
  </div></section>

  <section id="faq" class="section faq-section"><div class="container narrow"><div class="section-heading"><div class="eyebrow">Questions, answered</div><h2>No fine-print surprises</h2></div>
    <details><summary>Can I send to any purchased or scraped list?</summary><p>No. You must have a lawful basis and the permissions required where recipients live. Sakura Mail records consent and automatically includes unsubscribe controls, but the sender remains responsible for the list and message.</p></details>
    <details><summary>Does Sakura Mail read my contacts?</summary><p>Contact addresses are encrypted at rest and excluded from platform-admin views. The sending Worker must decrypt each address briefly to deliver scheduled mail. Access is minimized, logged and limited to service operation and legal/security obligations.</p></details>
    <details><summary>Why is the minimum purchase $${escapeHtml(env.MIN_PURCHASE_THOUSANDS)}?</summary><p>Small card and PayPal transactions have fixed processing costs. A modest minimum preserves the $1-per-1,000 rate without adding subscriptions or surprise fees.</p></details>
    <details><summary>Are attachments unlimited?</summary><p>No. Cloudflare Email Service currently limits the total message to 5 MiB and up to 32 attachments. The app enforces a 5 MiB file limit and checks the combined size before sending.</p></details>
    <details><summary>Is deliverability guaranteed?</summary><p>No responsible provider can guarantee inbox placement. Domain authentication, list quality, consent, message content and recipient-provider reputation all matter.</p></details>
  </div></section>

  <section class="cta-section"><div class="container cta-card"><img src="/logo.svg" alt=""><div><div class="eyebrow">Ready when you are</div><h2>Send the message. Keep the trust.</h2></div><a class="button light large" href="/login">Create an account</a></div></section>
</main>
<footer><div class="container footer-grid"><div>${logo}<p>Affordable, privacy-conscious email campaigns from the Sakura Software Solutions family.</p></div><div><b>Product</b><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="/login">Sign in</a></div><div><b>Legal</b><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a><a href="/security">Security</a></div><div><b>Company</b><a href="https://www.sakurasoftwaresolutions.com">Sakura Software Solutions</a><a href="mailto:alexdevriesxing@gmail.com">Contact</a></div></div><div class="container footer-bottom"><span>© ${new Date().getUTCFullYear()} Sakura Software Solutions</span><span>Built on Cloudflare</span></div></footer>`;
  return page('Email campaigns without the markup', body, env);
}
