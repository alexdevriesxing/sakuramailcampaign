# Delivery Provider Compatibility

Sakura Mail's application architecture is provider-adaptable: Workers, D1, R2, Queues, authentication, billing, sender identities, tags, segments, suppression and campaign workflows are separate from the final outbound delivery call.

## Current Cloudflare Email Service status

Cloudflare's current Email Service FAQ states that Email Service is intended only for transactional emails and that marketing email and bulk-sender tooling are planned for the future.

Therefore, do not launch promotional or newsletter campaigns through Cloudflare Email Service unless Cloudflare provides written confirmation that the intended traffic is permitted for the account and use case.

Before launch, choose one of these paths:

1. Obtain written Cloudflare approval for the exact traffic profile and keep that approval with the service's compliance records.
2. Switch `EMAIL_PROVIDER` to a provider whose current acceptable-use terms expressly permit compliant marketing campaigns (see below).
3. Limit Sakura Mail to genuinely transactional messages until an approved marketing-capable provider is configured.

## Switching delivery provider

Delivery is isolated behind the `EmailBinding` interface in `src/email-provider.ts`. It is the only file that knows how a message is physically sent — queueing, suppression, unsubscribe headers, open/click tracking, credits and reporting are all provider-agnostic and keep working unchanged.

Supported values for the `EMAIL_PROVIDER` var:

| Value | Delivery path | Requirements |
| --- | --- | --- |
| `cloudflare` (default) | The `EMAIL` send binding | Sending domain onboarded in Cloudflare Email Sending |
| `resend` | `https://api.resend.com/emails` | `RESEND_API_KEY` secret + domain verified in Resend |

To move to Resend:

1. Verify your sending domain in Resend and add the DNS records it provides (SPF/DKIM/DMARC).
2. Store the key: `npx wrangler secret put RESEND_API_KEY`
3. Set `"EMAIL_PROVIDER": "resend"` in `wrangler.jsonc`.
4. `npx wrangler deploy`, then send a campaign test to confirm delivery.

`FROM_EMAIL` and every sender identity must remain on the domain verified with the active provider — the application enforces this regardless of provider.

Adding another provider (SES, Postmark, etc.) means implementing one `send()` function in `src/email-provider.ts` and adding its name to the union; nothing else changes.

## Dynamic sender identities

The Worker binding is configured without a static `allowed_sender_addresses` list so the application can select workspace sender identities dynamically. The application restricts sender identities to the configured onboarded sending domain. Cloudflare still requires the sender domain to be onboarded, and any provider-specific verification and policy requirements remain applicable.

## Sources to re-check before every production release

- https://developers.cloudflare.com/email-service/reference/faq/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/email-service/platform/limits/
- https://developers.cloudflare.com/email-service/platform/pricing/
