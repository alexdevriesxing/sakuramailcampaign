# Sakura Mail Campaign

A production-oriented SaaS starter for affordable email campaigns under the Sakura Software Solutions brand.

![Sakura Mail logo](public/logo.png)

## What is included

- A polished marketing site with transparent `$1 / 1,000 email attempts` pricing.
- Passwordless accounts protected by Cloudflare Turnstile.
- Tenant-scoped workspaces with encrypted recipient addresses.
- HTML and plain-text campaign composer with merge fields.
- CSV import, manual contact entry, consent records and deduplication.
- R2 attachment storage with type and 5 MiB size enforcement.
- Send-now and scheduled campaigns using Cloudflare Queues and Cron Triggers.
- Automatic suppression checks and signed one-click unsubscribe links.
- PayPal Orders v2 checkout with server-side price calculation and capture validation.
- A platform-admin dashboard that exposes aggregate operations, not recipient addresses or message content.
- Privacy, security, terms, DPA and deployment documentation.

## Important product decisions

### The Cloudflare email stack is now suitable for this design

Cloudflare Email Service currently supports arbitrary outbound recipients on Workers Paid accounts after a sending domain is onboarded. Current published pricing is 3,000 outbound emails included per month and then `$0.35 per 1,000`. Cloudflare also documents a 5 MiB total message limit, up to 50 combined recipients per API submission and account-specific sending quotas.

This app deliberately sends one recipient per queued job. That protects recipient privacy, gives every message its own unsubscribe header and avoids exposing a mailing list through To/CC fields.

Official references:

- https://developers.cloudflare.com/email-service/platform/pricing/
- https://developers.cloudflare.com/email-service/platform/limits/
- https://developers.cloudflare.com/email-service/get-started/send-emails/

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
- Ensure the two `allowed_sender_addresses` in `wrangler.jsonc` exist and are authorized.
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
8. Request appropriate Cloudflare Email Service sending limits.
9. Add monitoring, backups, incident response and a published subprocessor list.

See [Deployment](docs/DEPLOYMENT.md) and [Product roadmap](docs/PRODUCT-ROADMAP.md).

## License

Copyright © Sakura Software Solutions. All rights reserved. See [LICENSE](LICENSE).
