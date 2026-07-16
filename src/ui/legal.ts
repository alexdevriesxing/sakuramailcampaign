import type { Env } from '../types';
import { escapeHtml } from '../security';
import { logo, page } from './shared';

export function privacyPage(env: Env): string {
  const body = `${legalHeader('Privacy Policy')}<main class="legal container narrow"><p class="legal-updated">Effective: July 16, 2026</p><h1>Privacy Policy</h1><p class="lead">Sakura Mail is designed to process mailing data for customers without turning that data into a separate product.</p>
  <h2>1. Who we are</h2><p>Sakura Mail is a service in the Sakura Software Solutions family. Contact: <a href="mailto:alexdevriesxing@gmail.com">alexdevriesxing@gmail.com</a>. The final operating entity, postal address and jurisdiction must be inserted before production launch.</p>
  <h2>2. Roles</h2><p>For account, billing and service-operation data, Sakura Mail acts as a data controller. For recipient lists and campaign content uploaded by a customer, the customer is generally the controller and Sakura Mail acts as a processor or service provider, processing data on documented instructions to provide the service.</p>
  <h2>3. Data we process</h2><p>Account email, authentication and session records; workspace and sender settings; payment order identifiers and amounts; encrypted recipient addresses, names, consent records and optional metadata; campaign content, attachments and schedules; delivery, suppression, security and audit events; and limited technical data such as IP-derived security hashes and user-agent strings.</p>
  <h2>4. Why we process it</h2><p>To create and secure accounts, store and send campaigns, maintain suppression lists, process payments, prevent abuse, troubleshoot delivery, comply with law, and protect users and the service. We do not sell or rent personal data, use recipient lists for independent marketing, or build advertising profiles from campaign data.</p>
  <h2>5. Security and access</h2><p>Recipient addresses are encrypted at rest using AES-256-GCM. The application scopes data operations to the authenticated workspace. Platform-admin analytics are designed not to expose recipient addresses or campaign bodies. Scheduled sending is not zero-knowledge: authorized Worker code must decrypt an address immediately before sending. Personnel or contractors may access data only when strictly necessary for support, security, incident response or legal obligations, under access controls and logging.</p>
  <h2>6. Service providers</h2><p>Cloudflare provides hosting, Workers, D1, R2, Queues, bot protection and email delivery. PayPal processes checkout and payment data. These providers process information under their own terms and privacy notices. A production subprocessor list and data-processing terms should be published before launch.</p>
  <h2>7. Retention</h2><p>Account and billing records are retained while the account is active and as needed for legal, tax and fraud-prevention duties. Campaign and contact data remain until deleted by the customer or the account is closed, subject to backup and legal-retention periods. Suppression records may be retained longer so an opted-out address is not accidentally mailed again. Login codes expire within minutes; sessions expire or are revoked.</p>
  <h2>8. International transfers</h2><p>Cloud providers may process data in multiple countries. Where required, Sakura Mail will use appropriate contractual and legal transfer mechanisms. Customers must evaluate their own transfer obligations for uploaded recipient data.</p>
  <h2>9. Your choices and rights</h2><p>Account holders can access, correct, export or delete workspace data through the product or by contacting us. Recipients should normally contact the sender shown in the email; they can also use the included unsubscribe link. Depending on location, people may have rights to access, correction, deletion, restriction, objection, portability or complaint to a regulator.</p>
  <h2>10. Cookies</h2><p>The service uses an essential, secure session cookie for authentication. PayPal and Cloudflare Turnstile may set or read data needed to provide payment and anti-abuse functions. We do not deploy advertising cookies in this starter implementation.</p>
  <h2>11. Children</h2><p>The service is intended for businesses and adults, not children. Customers may not knowingly upload children’s data without a valid legal basis and appropriate safeguards.</p>
  <h2>12. Changes</h2><p>Material changes will be posted with a new effective date and, where required, communicated to account holders.</p>
  <div class="legal-notice"><b>Launch requirement</b><p>This policy is a strong product template, not a substitute for advice from a lawyer familiar with the operating entity, countries served and actual data flows. Replace placeholders and obtain legal review before accepting real customers.</p></div></main>${legalFooter(env)}`;
  return page('Privacy Policy', body, env);
}

export function termsPage(env: Env): string {
  const body = `${legalHeader('Terms of Service')}<main class="legal container narrow"><p class="legal-updated">Effective: July 16, 2026</p><h1>Terms of Service</h1><p class="lead">These terms govern use of Sakura Mail. The final legal entity, address, governing law and dispute forum must be completed before launch.</p>
  <h2>1. Eligibility and account security</h2><p>You must be legally able to enter a contract, provide accurate information, protect account access and promptly report suspected compromise. You are responsible for activity in your workspace.</p>
  <h2>2. Permitted use</h2><p>You may use Sakura Mail only for lawful email to recipients you are permitted to contact. You must maintain evidence of consent or another lawful basis, accurate sender identification, a valid postal address and legally required disclosures.</p>
  <h2>3. Prohibited use</h2><p>No purchased, harvested or scraped lists; unsolicited bulk mail; deceptive headers or subjects; phishing; malware; credential theft; illegal goods or services; harassment; evasion of suppression lists; attempts to probe other tenants; or use that harms deliverability, Cloudflare, PayPal, recipients or the service.</p>
  <h2>4. Customer responsibilities</h2><p>You control campaign content and recipient selection and remain responsible for compliance with CAN-SPAM, CASL, GDPR/ePrivacy and other applicable rules. Platform features assist compliance but do not provide legal permission to send.</p>
  <h2>5. Credits and payment</h2><p>Credits are sold at the displayed price, currently $1 per 1,000 email attempts, with a minimum purchase shown at checkout. One credit is reserved per selected active recipient. An attempt may count once accepted into the delivery pipeline even if it later bounces. Taxes and refunds are handled as disclosed at checkout and required by law. Credits have no cash value, are non-transferable and may be suspended during disputes or abuse investigations.</p>
  <h2>6. Deliverability and limits</h2><p>Delivery, inbox placement, timing and uninterrupted availability are not guaranteed. Sending is subject to account quotas, rate limits, message-size limits, provider policies, reputation and recipient systems. We may throttle or pause campaigns to protect users and infrastructure.</p>
  <h2>7. Data and licenses</h2><p>You retain rights in your data and content. You grant Sakura Mail a limited license to host, copy, transmit, format and process them only as needed to provide, secure and support the service and comply with law. You represent that you have the rights and permissions needed for uploaded data and content.</p>
  <h2>8. Suspension and termination</h2><p>We may suspend or terminate accounts for abuse, legal risk, nonpayment, security threats or provider-policy violations. You may close your account and request deletion, subject to retention needed for billing, security, suppression and legal duties.</p>
  <h2>9. Warranties and liability</h2><p>The service is provided “as is” and “as available” to the extent permitted by law. The final agreement should include jurisdiction-appropriate warranty disclaimers, liability caps, indemnity, consumer-law carve-outs and exclusions reviewed by counsel.</p>
  <h2>10. Changes and contact</h2><p>We may update these terms prospectively. Material changes will be communicated when required. Contact <a href="mailto:alexdevriesxing@gmail.com">alexdevriesxing@gmail.com</a>.</p>
  <div class="legal-notice"><b>Launch requirement</b><p>Do not rely on this template as “foolproof.” No policy can eliminate legal risk. Have qualified counsel tailor it to your entity, location, customers, refund practice and processor agreements.</p></div></main>${legalFooter(env)}`;
  return page('Terms of Service', body, env);
}

export function securityPage(env: Env): string {
  const body = `${legalHeader('Security')}<main class="legal container narrow"><h1>Security at Sakura Mail</h1><p class="lead">Defense in depth, least privilege and honest claims—not promises of impossible “100% security.”</p>
  <h2>Current controls in this codebase</h2><ul><li>Passwordless one-time-code authentication with hashed, expiring codes.</li><li>Secure, HttpOnly, SameSite session cookies; server-side session revocation.</li><li>Mandatory Cloudflare Turnstile validation and D1-backed rate limiting.</li><li>Origin checks for state-changing requests and restrictive browser security headers.</li><li>AES-256-GCM encryption for recipient addresses and HMAC-based deduplication.</li><li>Workspace-scoped database and R2 access in application routes.</li><li>Automatic suppression checks and signed one-click unsubscribe tokens.</li><li>PayPal orders created and captured server-side; prices are never trusted from the browser.</li><li>Audit logs that avoid raw recipient addresses.</li><li>Admin analytics intentionally omit contact addresses and message bodies.</li></ul>
  <h2>Operational controls required before launch</h2><ul><li>Protect the GitHub repository and Cloudflare account with hardware-key MFA and least-privilege roles.</li><li>Store secrets with Wrangler secrets; rotate them and never commit production credentials.</li><li>Enable dependency scanning, branch protection, review, backups, alerting and an incident-response plan.</li><li>Complete an independent security review and penetration test.</li><li>Establish a vulnerability-reporting mailbox and response targets.</li></ul>
  <h2>Report a concern</h2><p>Send security reports to <a href="mailto:alexdevriesxing@gmail.com">alexdevriesxing@gmail.com</a>. Do not include live recipient data in a report.</p></main>${legalFooter(env)}`;
  return page('Security', body, env);
}

function legalHeader(label: string): string {
  return `<header class="site-header legal-header"><div class="container nav-wrap">${logo}<nav><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/security">Security</a></nav><span class="legal-label">${escapeHtml(label)}</span></div></header>`;
}

function legalFooter(env: Env): string {
  return `<footer><div class="container footer-bottom"><span>© ${new Date().getUTCFullYear()} ${escapeHtml(env.APP_NAME)}</span><a href="mailto:alexdevriesxing@gmail.com">Contact</a></div></footer>`;
}

export function unsubscribePage(env: Env, token: string, state: 'confirm' | 'success' | 'invalid'): string {
  const content = state === 'success'
    ? `<div class="success-mark">✓</div><h1>You are unsubscribed</h1><p>This address will be suppressed from future mailings from this sender.</p>`
    : state === 'invalid'
      ? `<div class="error-mark">!</div><h1>Link unavailable</h1><p>This unsubscribe link is invalid or expired. Contact the sender shown in the original message.</p>`
      : `<img src="/logo.svg" alt=""><h1>Stop future mailings?</h1><p>Confirm once and this address will be added to the sender’s suppression list.</p><form method="post"><button class="button primary large" type="submit">Unsubscribe</button></form>`;
  return page('Unsubscribe', `<main class="auth-page"><section class="auth-card unsubscribe-card">${content}<a href="/">About Sakura Mail</a></section></main>`, env);
}
