# Delivery Provider Compatibility

Sakura Mail's application architecture is provider-adaptable: Workers, D1, R2, Queues, authentication, billing, sender identities, tags, segments, suppression and campaign workflows are separate from the final outbound delivery call.

## Current Cloudflare Email Service status

Cloudflare's current Email Service FAQ states that Email Service is intended only for transactional emails and that marketing email and bulk-sender tooling are planned for the future.

Therefore, do not launch promotional or newsletter campaigns through Cloudflare Email Service unless Cloudflare provides written confirmation that the intended traffic is permitted for the account and use case.

Before launch, choose one of these paths:

1. Obtain written Cloudflare approval for the exact traffic profile and keep that approval with the service's compliance records.
2. Replace the delivery adapter in `src/email.ts` with a provider whose current acceptable-use terms expressly permit compliant marketing campaigns.
3. Limit Sakura Mail to genuinely transactional messages until an approved marketing-capable provider is configured.

## Dynamic sender identities

The Worker binding is configured without a static `allowed_sender_addresses` list so the application can select workspace sender identities dynamically. The application restricts sender identities to the configured onboarded sending domain. Cloudflare still requires the sender domain to be onboarded, and any provider-specific verification and policy requirements remain applicable.

## Sources to re-check before every production release

- https://developers.cloudflare.com/email-service/reference/faq/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/email-service/platform/limits/
- https://developers.cloudflare.com/email-service/platform/pricing/
