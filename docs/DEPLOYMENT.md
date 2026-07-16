# Deployment Runbook

## 1. Account protection

Before creating production resources:

- Enable hardware-key MFA on Cloudflare, GitHub and PayPal.
- Use separate named administrator accounts.
- Restrict GitHub branch writes and require pull-request review.
- Do not share the owner password or API tokens.

## 2. Cloudflare resources

Create the D1 database, R2 bucket and queues:

```bash
npx wrangler d1 create sakura-mail-db
npx wrangler r2 bucket create sakura-mail-files
npx wrangler queues create sakura-mail-send
npx wrangler queues create sakura-mail-dead-letter
```

Insert the real D1 ID into `wrangler.jsonc`.

Apply migrations:

```bash
npm run db:migrate:remote
```

## 3. Email Service

In Cloudflare Dashboard:

1. Open Compute → Email Service → Email Sending.
2. Onboard the production sending domain.
3. Allow Cloudflare to create the bounce MX, SPF and DKIM records.
4. Confirm domain status is active.
5. Ensure the configured sender addresses are permitted.
6. Request a higher sending limit before onboarding customers.

Use a dedicated subdomain such as `mail.sakurasoftwaresolutions.com` so marketing reputation is separated from critical corporate mail.

## 4. Turnstile

Create separate development and production widgets. Restrict the production widget to the final hostname. Set:

- Public site key in `wrangler.jsonc`.
- Secret with `wrangler secret put TURNSTILE_SECRET_KEY`.

The server-side Siteverify call is mandatory.

## 5. PayPal

Use a PayPal Business account associated with `alexdevriesxing@gmail.com` if that is the intended settlement account.

Create a REST application and set:

```bash
npx wrangler secret put PAYPAL_CLIENT_SECRET
```

Set the matching public client ID and keep `PAYPAL_MODE=sandbox` through acceptance testing. Switch to `live` only after verifying:

- Correct amounts.
- Cancelled checkout.
- Duplicate capture calls.
- Failed captures.
- Refund and dispute operations.
- Tax and invoice requirements.

The email address variable is descriptive; the credentials determine the receiving merchant.

## 6. Application secrets

Generate independent values:

```bash
openssl rand -hex 48       # AUTH_PEPPER
openssl rand -base64 32    # DATA_ENCRYPTION_KEY
```

Store them with Wrangler secrets. Keep an encrypted recovery copy in an approved secret manager. Loss of the encryption key makes recipient addresses unrecoverable.

## 7. Domain and routing

Set the final `APP_URL`. Deploy, then attach the Worker to the intended custom domain in Cloudflare. Redirect alternate hostnames to one canonical HTTPS origin.

## 8. Pre-launch validation

Run:

```bash
npm install
npm test
npx wrangler deploy --dry-run
npm run deploy
```

Test:

- New and returning sign-in.
- Turnstile rejection and rate limits.
- Cross-workspace access attempts.
- CSV import and deduplication.
- File upload/download/delete.
- Campaign credit reservation.
- Scheduled and immediate sends.
- Personalization and plain-text fallback.
- Unsubscribe GET confirmation and POST completion.
- PayPal sandbox and live smoke tests.
- Attachment and total-message limits.
- Error logs and dead-letter queue.

## 9. Operations

Configure alerts for:

- Worker exceptions.
- Queue retries and dead-letter growth.
- Email rejection, bounce and complaint rates.
- PayPal capture failures.
- D1 and R2 usage.
- Login abuse.
- Sudden sending-volume changes.

Document backup, restoration, incident response, law-enforcement requests, account closure and data-deletion procedures.
