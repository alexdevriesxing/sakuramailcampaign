# Security Design and Threat Model

## Security claim

No internet service is “100% secure.” The goal is to reduce likelihood and impact through layered controls, monitoring and honest communication.

## Primary threats

### Account takeover

Controls:

- Passwordless codes with a 10-minute lifetime and single use.
- Hashed codes and sessions.
- HttpOnly, Secure, SameSite cookies.
- Turnstile and per-IP/per-address rate limits.
- Session expiry and server-side logout.

Recommended additions:

- WebAuthn/passkeys.
- Session/device management.
- Risk-based step-up authentication.
- Organization SSO for larger customers.

### Cross-tenant access

Controls:

- Workspace identity comes from the session, not browser input.
- Workspace clauses on contacts, campaigns, files, settings and billing.
- R2 keys include workspace IDs.
- Admin endpoints are separate and aggregate-only.

Required testing:

- Automated authorization tests for every route and object ID.
- Fuzzing of file and campaign identifiers.

### Recipient-data disclosure

Controls:

- AES-256-GCM encryption at rest.
- Raw addresses omitted from audit and admin output.
- UI masks addresses in list views.
- Decryption occurs in the authenticated API or send consumer only.

Residual risk:

- The production Worker secret and code can decrypt addresses.
- An authorized operator with deployment access could alter the Worker.
- Logs or provider systems may process delivery metadata.

Mitigations:

- Hardware-key MFA.
- Two-person review for production deployments.
- Restricted log access and no sensitive debug logging.
- Secret rotation and key-version design.
- Independent audit.

### Payment manipulation

Controls:

- Quantity validation on the server.
- Server-calculated amount.
- OAuth credentials only in Worker secrets.
- Workspace and amount validation after capture.
- Conditional order completion to prevent duplicate credits.

### Spam and platform abuse

Controls:

- Consent fields.
- Required sender identity and postal address.
- Suppression checks immediately before send.
- One-click unsubscribe.
- Queue-based throttling.
- Platform ability to pause abusive workspaces should be added before public launch.

Recommended additions:

- New-account sending limits.
- Manual review thresholds.
- Domain ownership verification per customer.
- Complaint and bounce ingestion.
- Content and URL malware scanning.
- Abuse-reporting workflow.

### Malicious files

Controls:

- Allowlisted content types.
- Five MiB limit.
- Sanitized filenames.
- Forced attachment download.

Recommended additions:

- File-signature validation.
- Malware scanning.
- Quarantine before attachment eligibility.

## Browser controls

- Content Security Policy.
- HSTS.
- No framing.
- MIME sniffing disabled.
- Restricted permissions policy.
- Origin checks on state-changing requests.

The PayPal and Turnstile domains are explicit CSP exceptions.

## Secret inventory

- `AUTH_PEPPER`
- `DATA_ENCRYPTION_KEY`
- `TURNSTILE_SECRET_KEY`
- `PAYPAL_CLIENT_SECRET`

Never put real values in Git, client-side JavaScript, issue trackers or support screenshots.
