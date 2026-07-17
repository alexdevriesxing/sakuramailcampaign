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

## 3. Email delivery (Resend)

`EMAIL_PROVIDER` is `resend`, because Cloudflare Email Sending documents itself as transactional-only while this product sends marketing campaigns. See [PROVIDER-COMPATIBILITY.md](./PROVIDER-COMPATIBILITY.md).

1. Create a Resend account and add the sending domain **`mail.sakurasoftwaresolutions.com`**.
   Use the dedicated subdomain, not the root, so campaign reputation stays separate from critical corporate mail.
2. Resend shows a set of DNS records — typically an `MX` and SPF `TXT` on a `send` subdomain, plus a DKIM `TXT` at `resend._domainkey`. Add each one in Cloudflare DNS for `sakurasoftwaresolutions.com`.
   - Records must be **DNS only** (grey cloud), never proxied.
   - They coexist with the Worker's custom-domain record on the same hostname; `MX`/`TXT` and `A` do not conflict.
3. Wait for Resend to report the domain **Verified**.
4. Create an API key (send access) and store it:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
5. Add a DMARC record (`_dmarc` TXT, start with `v=DMARC1; p=none; rua=...`) once SPF and DKIM pass.
6. Confirm every sender identity and `FROM_EMAIL` sit on the verified domain — the app enforces this.
7. Check the Resend sending limits and per-1,000 price for your expected volume before onboarding customers.

Verify end to end: request a login code at `/login` (proves delivery works), then use a campaign **Test** send.

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
