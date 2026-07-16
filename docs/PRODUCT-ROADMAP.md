# Product Roadmap

## Required before public launch

- Domain verification and SPF/DKIM health checks.
- New-account sending limits and manual abuse review.
- Bounce and complaint ingestion with automatic suppression.
- Campaign pause/cancel and queue reconciliation.
- Credit ledger instead of a balance-only field.
- Workspace deletion/export and data-subject request workflows.
- Malware scanning for attachments.
- Automated authorization and payment tests.
- Production monitoring and dead-letter tooling.
- Legal entity, tax, refund and subprocessor finalization.

## High-value product additions

### Templates and preview

- Reusable branded templates.
- Mobile/desktop preview.
- Test email sends to verified addresses.
- Link checker and accessibility warnings.

### Better audience tools

- Saved segments and tags.
- Custom fields and richer merge variables.
- Consent-expiry rules by jurisdiction.
- Duplicate and risky-address reports.

### Deliverability

- Per-customer sending-domain onboarding.
- DNS status dashboard.
- Bounce categories and complaint rates.
- Automatic warm-up and throttling.
- Inbox-placement guidance without guarantees.

### Collaboration

- Invitations and role management.
- Approval workflows.
- Passkeys and enterprise SSO.
- Detailed audit viewer.

### Analytics

- Privacy-conscious open and click tracking as an explicit opt-in.
- Conversion webhooks.
- Campaign comparisons and A/B tests.
- Exportable delivery reports.

Open tracking should not be enabled silently: pixels are privacy-sensitive and increasingly unreliable. Start with accepted/failed/bounce/complaint metrics.

### Developer platform

- API keys scoped by workspace and permission.
- Webhooks with signatures and retries.
- Contact and campaign APIs.
- Zapier/Make integrations.

## Enterprise isolation option

For customers who truly need a dedicated backend, investigate Workers for Platforms or separate Cloudflare accounts/resources. Price that tier according to the real isolation and operational cost rather than claiming the shared-workspace architecture is physically dedicated.
