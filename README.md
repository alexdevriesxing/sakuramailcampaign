# Sakura Mail Campaign

A production-oriented SaaS starter for affordable email campaigns under the Sakura Software Solutions brand.

![Sakura Mail logo](public/logo.svg)

## What is included

- A polished marketing site with transparent `$1 / 1,000 email attempts` pricing.
- Passwordless accounts protected by Cloudflare Turnstile.
- Tenant-scoped workspaces with encrypted recipient addresses.
- HTML and plain-text campaign composer with merge fields, preheader/preview text, reusable saved templates, a device (desktop/mobile) preview, and one-click test sends to your own address.
- CSV import, manual contact entry, consent records and deduplication.
- Contact tags, filtering, bulk tag assignment, sorting and reusable audience segments.
- Re-engagement targeting: build an audience from how people engaged with an earlier campaign (opened / did not open / clicked / did not click), with a one-click "resend to non-openers" that pre-fills a follow-up campaign. "Did not open" only counts recipients the campaign was actually delivered to, and combines with any saved segment.
- A live server-side audience count in the campaign builder, so you see exactly how many recipients match before you send.
- Multiple sender identities with per-campaign display-name and reply-to overrides.
- R2 attachment storage with type and 5 MiB size enforcement.
- Send-now and scheduled campaigns using Cloudflare Queues and Cron Triggers.
- Automatic suppression checks and signed one-click unsubscribe links.
- Hard-bounce detection that flags and suppresses dead addresses, so bounced and unsubscribed contacts are automatically excluded from future campaigns.
- Optional, per-campaign open and click tracking (off by default): a signed open pixel and signed link-redirects, disclosed in the message footer, with an open-redirect-safe design.
- A reports & analytics view with deliverability KPIs, engagement metrics (open/click/click-to-open rates, top links), a 30-day send trend chart, per-campaign performance, failure-reason and audience-health breakdowns, and spend — all rendered with dependency-free inline SVG (no third-party scripts, CSP-safe).
- Per-recipient engagement drill-down (which address opened/clicked, with counts and CSV export), restricted to owner/admin roles.
- PayPal Orders v2 checkout with server-side price calculation and capture validation.
- A platform-admin dashboard that exposes aggregate operations, not recipient addresses or message content.
- Privacy, security, terms, DPA and deployment documentation.

## Important product decisions

### Delivery runs on Resend, not Cloudflare Email Sending

`EMAIL_PROVIDER` is set to `resend`. Cloudflare Email Sending is excellent infrastructure, but its FAQ currently states the service is intended for transactional email, with marketing/bulk-sender tooling planned for the future — and this product exists to send opt-in **marketing** campaigns. Rather than build a business on a use case the provider documents as out of scope, delivery runs on a provider whose acceptable-use terms expressly permit compliant marketing email.

Everything else still runs on Cloudflare: Workers, D1, R2, Queues, Cron, Turnstile and asset hosting. Only the final outbound `send()` call changed, and it is isolated in `src/email-provider.ts` — switching back to `cloudflare`, or on to SES/Postmark, is a config change plus one function. See [docs/PROVIDER-COMPATIBILITY.md](docs/PROVIDER-COMPATIBILITY.md).

This app deliberately sends one recipient per queued job. That protects recipient privacy, gives every message its own unsubscribe header and avoids exposing a mailing list through To/CC fields.

Setup requirements:

- The sending domain must be verified in Resend (SPF/DKIM DNS records).
- `RESEND_API_KEY` must be stored with `wrangler secret put`.
- Check Resend's current per-1,000 pricing against the `$1 / 1,000` retail price to confirm the margin still works at your volume.

### PayPal cannot be securely “wired” using an email address alone

`alexdevriesxing@gmail.com` is configured as the intended merchant/contact account and is shown in billing settings. Actual settlement is controlled by the PayPal REST application credentials. The production `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` must come from the PayPal Business account that should receive the money.

The browser never chooses the price. The Worker creates the order, captures it and verifies the amount, currency and workspace identifier before adding credits.

Official references:

- https://developer.paypal.com/api/rest/
- https://developer.paypal.com/api/rest/integration/orders-api/
- https://developer.paypal.com/api/rest/authentication/

### Honest privacy, not an impossible promise

A scheduled email service cannot truthfully claim that its operator has absolutely no technical access to recipient addresses. The sending application must process an address to deliver a message, and a Cloudflare account owner can change deployed code.

This implementation instead provides defensible controls:

- AES-256-GCM encryption at rest.
- HMAC hashes for deduplication and suppression checks.
- Just-in-time decryption inside the queue consumer.
- Workspace-scoped database and R2 queries.
- Platform-admin APIs that omit contacts and campaign bodies.
- Audit logs that do not store raw recipient addresses.
- Least-privilege operational guidance.

Use wording such as “encrypted at rest, access restricted and not used or sold” rather than “we can never access your data.”

## Architecture

```text
Browser
  │
  ├── Cloudflare Turnstile
  │
  ▼
Cloudflare Worker (pages + API)
  ├── D1: accounts, workspaces, campaigns, encrypted contacts, credits, logs
  ├── R2: attachments
  ├── PayPal Orders v2: prepaid credit purchases
  └── Queue producer
          │
          ▼
     Queue consumer
       ├── suppression check
       ├── just-in-time address decryption
       ├── unsubscribe header/footer injection
       └── Cloudflare Email Service
```

See [Architecture](docs/ARCHITECTURE.md) for the data model and trust boundaries.

## Local setup

### 1. Install

```bash
npm install
```

### 2. Create Cloudflare resources

```bash
npx wrangler d1 create sakura-mail-db
npx wrangler r2 bucket create sakura-mail-files
npx wrangler queues create sakura-mail-send
npx wrangler queues create sakura-mail-dead-letter
```

Copy the returned D1 database ID into `wrangler.jsonc`.

### 3. Apply migrations

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

### 4. Generate secrets

Generate a 32-byte encryption key:

```bash
openssl rand -base64 32
```

Set production secrets:

```bash
npx wrangler secret put AUTH_PEPPER
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put PAYPAL_CLIENT_SECRET
```

For local development, copy `.dev.vars.example` to `.dev.vars` and insert sandbox/test values.

### 5. Configure services

- Create a Turnstile widget and replace `TURNSTILE_SITE_KEY`.
- Create a PayPal REST app under the merchant account and replace `PAYPAL_CLIENT_ID`.
- Keep `PAYPAL_MODE=sandbox` until end-to-end testing is complete.
- Onboard `mail.sakurasoftwaresolutions.com` in Cloudflare Email Service.
- Verify SPF, DKIM and bounce-domain records created by Cloudflare.
- The Email binding is intentionally not restricted to a static sender allowlist so workspace sender identities can be selected dynamically. Application validation still limits senders to the onboarded domain.
- Verify every address/domain used by a sender identity is permitted by your Cloudflare Email Service configuration and policy.
- Replace `APP_URL` with the production hostname.

### 6. Run

```bash
npm run dev
```

### 7. Validate and deploy

```bash
npm test
npx wrangler deploy --dry-run
npm run deploy
```

## Pricing model

The app sells prepaid attempts at `$1 per 1,000`, with a default minimum purchase of `$5 / 5,000` attempts. The minimum matters because fixed PayPal processing fees can erase the margin on a `$1` transaction.

A conservative unit-economics model should include:

- Cloudflare Email Service usage.
- Workers requests and CPU.
- Queue operations.
- D1 reads/writes and storage.
- R2 storage and operations.
- PayPal fees, refunds and disputes.
- Taxes, support and abuse losses.

Do not market the difference between `$1.00` and `$0.35` as pure profit.

## Compliance defaults

The product requires a business name, physical postal address and verified sender before a campaign can send. Every marketing email receives an unsubscribe link and List-Unsubscribe headers. Contacts can record consent status, source and time.

These features assist compliance but do not make an unlawful list lawful. Customers remain responsible for their recipient permissions and content. The legal templates require qualified review before launch.

Relevant official guidance:

- FTC CAN-SPAM guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- CRTC CASL FAQ: https://www.crtc.gc.ca/eng/com500/faq500.htm
- GDPR Article 5: https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj

## Launch blockers

Before accepting real customers:

1. Replace every placeholder in `wrangler.jsonc`.
2. Add the final legal entity name, address, jurisdiction and support/security contacts.
3. Obtain legal review of privacy, terms, refunds, taxes and the DPA.
4. Complete a security review and penetration test.
5. Enable hardware-key MFA and branch protection.
6. Test PayPal sandbox create/capture/idempotency flows.
7. Test sending, unsubscribe, bounce and complaint workflows on a dedicated sending subdomain.
8. Obtain written confirmation that the intended campaign traffic is permitted by Cloudflare Email Service, or replace the delivery adapter with a marketing-email provider.
9. Request appropriate provider sending limits.
10. Add monitoring, backups, incident response and a published subprocessor list.

See [Deployment](docs/DEPLOYMENT.md) and [Product roadmap](docs/PRODUCT-ROADMAP.md).

## License

Copyright © Sakura Software Solutions. All rights reserved. See [LICENSE](LICENSE).
