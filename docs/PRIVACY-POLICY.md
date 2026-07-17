# Privacy Policy Template

Effective date: July 16, 2026

> **Legal review required:** Insert the final legal entity, address, governing jurisdiction, representative/DPO details and complete subprocessor list before launch. This template is not legal advice and cannot be made “foolproof.”

## Scope and roles

Sakura Mail processes account, billing, security and service-operation data as a controller. For recipient lists and campaign content uploaded by customers, the customer generally determines the purposes and means of processing and Sakura Mail acts as a processor or service provider.

## Data processed

- Account email and authentication/session records.
- Workspace, sender and compliance settings.
- PayPal order identifiers, amounts, status and capture references.
- Encrypted recipient addresses, names, consent records and customer-supplied metadata.
- Campaign content, attachments, schedules and delivery events.
- Optional, per-campaign engagement events (email opens and link clicks) recorded only when the campaign sender explicitly enables tracking for that campaign.
- Suppression, security and audit records.
- Limited technical information such as IP-derived security hashes and user-agent strings.

## Purposes

Data is processed to provide and secure accounts, store and deliver campaigns, process payments, maintain suppression lists, prevent abuse, troubleshoot service operation, comply with law and protect users and infrastructure.

Sakura Mail does not sell or rent recipient data, use customer lists for its own marketing or create advertising profiles from campaign content.

## Access and security

Recipient addresses are encrypted at rest with AES-256-GCM. Application queries are scoped to the authenticated workspace. Platform-admin reports are designed not to expose recipient addresses or campaign content.

Scheduled sending is not zero-knowledge. Authorized application code must briefly decrypt an address to transmit the message. Human access is restricted to cases reasonably necessary for support, security, incident response or legal obligations, and should be subject to least privilege and audit controls.

## Service providers

Cloudflare provides hosting, Workers, D1, R2, Queues, Turnstile and email delivery. PayPal processes checkout and payments. Production terms should identify all subprocessors, locations and transfer mechanisms.

## Retention

Deleting a contact erases that person's record together with their send history and any open/click events, so no personal data about them remains. Their suppression record (an irreversible hash of the address, with the reason) is deliberately retained so an unsubscribed or bounced address can never be silently re-mailed if the same list is imported again. Because engagement events are erased with the contact, historical campaign totals may decrease after a deletion.

Customer content is kept while the account is active or until deleted, subject to backups and legal requirements. Billing records may be retained for tax, fraud and dispute obligations. Suppression records may be retained after other contact data is deleted to prevent accidental re-mailing. Expired login codes and sessions are removed automatically.

## Rights and choices

Account holders can request access, correction, export or deletion. Recipients should use the email's unsubscribe control or contact the sender. Depending on jurisdiction, individuals may also have rights to restriction, objection, portability and regulator complaint.

## International transfers

Cloud services may process data in multiple countries. Appropriate transfer safeguards must be adopted where required. Customers are responsible for evaluating their own recipient-data transfers.

## Cookies

The application uses an essential authentication cookie. Turnstile and PayPal may process data needed for anti-abuse and checkout. The starter does not include advertising cookies.

## Email measurement (open and click tracking)

Open and click tracking is **off by default** and is enabled per campaign by the sender, not by Sakura Mail. When a sender enables it:

- **Open tracking** embeds a 1×1 pixel that requests an image from this service when the message is displayed, recording an open for that recipient and campaign. Open counts are approximate because some mail clients (for example, Apple Mail Privacy Protection) pre-fetch or block images.
- **Click tracking** rewrites links so they pass through a signed redirect on this service, recording which recipient clicked which link before forwarding them to the original destination.
- Messages that use tracking disclose it to recipients in the footer.

Senders act as the controller for this measurement and are responsible for a lawful basis and any consent their jurisdiction requires (for example, GDPR/ePrivacy). Engagement records are workspace-scoped and are deleted with the campaign or contact.

## Contact and changes

Contact: alexdevriesxing@gmail.com

Material changes should be posted with a revised effective date and communicated where law requires.
