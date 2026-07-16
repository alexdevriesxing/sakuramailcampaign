# Architecture

## Goals

Sakura Mail is a multi-tenant email campaign application optimized for low operating cost, understandable pricing and a narrow privacy boundary.

The first version uses one Cloudflare Worker deployment with strict logical tenant isolation. It does not create a physically separate Worker and database for every customer. Calling the current design a “dedicated backend” would be misleading; each customer receives a dedicated workspace whose rows and R2 objects are scoped by `workspace_id`.

A future enterprise tier could use Workers for Platforms or separate Cloudflare accounts for stronger physical isolation.

## Components

### Browser application

The public site and dashboard are dependency-light HTML, CSS and JavaScript. The browser:

- Renders Turnstile.
- Parses CSV locally.
- Sends structured batches to the API.
- Loads PayPal's JavaScript SDK only on the billing screen.
- Never receives PayPal secrets or the contact-encryption key.

### Worker API

The Worker provides:

- Passwordless authentication.
- Multiple sender identities scoped to each workspace.
- Contact filtering, bulk tags and saved segment rule evaluation.
- Session and role enforcement.
- Tenant-scoped CRUD.
- Campaign validation and credit reservation.
- PayPal order creation and capture.
- Queue fan-out and scheduled dispatch.
- Security headers, origin validation and rate limiting.

### D1

D1 stores relational application state. Sensitive recipient addresses are ciphertext; deterministic HMAC values support deduplication and suppression without storing a reversible lookup key.

Core tables:

- `users`, `sessions`, `login_codes`
- `workspaces`, `memberships`
- `contacts`, `tags`, `contact_tags`, `segments`, `suppressions`
- `sender_identities`, `campaigns`, `campaign_attachments`, `send_events`
- `files`, `billing_orders`, `audit_logs`, `rate_limits`

### R2

Files are stored at:

```text
<workspace_id>/<file_id>/<sanitized_filename>
```

The database record and every download/delete query also require the signed-in workspace ID.

### Queues

A campaign snapshots its selected segment rules, evaluates the matching active and unsuppressed contacts at dispatch time, reserves one credit per eligible contact, writes an idempotent queued send event and publishes one queue message per recipient. The consumer:

1. Reloads the campaign and contact using the workspace ID.
2. Rechecks the suppression table.
3. Decrypts the address.
4. Personalizes content.
5. Adds unsubscribe controls and the required sender footer.
6. Fetches attachments from R2.
7. Calls Cloudflare Email Service.
8. Updates the send event and campaign counters.

### Cron Trigger

A five-minute trigger finds due scheduled campaigns and dispatches them. It also removes expired login codes, sessions and rate-limit buckets.

### PayPal

The Orders v2 integration is server-authoritative:

- The browser sends only the selected credit quantity.
- The Worker calculates the amount.
- PayPal receives an internal order ID and workspace ID.
- Capture validates `COMPLETED`, `USD`, exact amount and the workspace custom ID.
- A conditional D1 update prevents double-crediting.

## Trust boundaries

### Platform operator

The platform operator controls the Cloudflare account and deployed code. Therefore this is not a zero-knowledge system. Controls reduce routine access and accidental exposure but cannot make operator access mathematically impossible.

### Platform-admin UI

The admin endpoint returns only aggregate user, workspace, send and revenue totals. It intentionally omits:

- Contact addresses and names.
- Campaign subjects and bodies.
- Attachments.
- Authentication codes and session tokens.

### Customer workspace

Application routes derive the workspace from the authenticated session. They do not accept an arbitrary workspace ID from the browser for normal CRUD operations.

## Encryption

Recipient addresses use AES-256-GCM with a fresh 96-bit IV per encryption. The key is stored as a Cloudflare Worker secret. HMAC-SHA-256 with a separate application pepper produces lookup hashes.

Key rotation is not yet automated. A production key-rotation plan should introduce key versions and a background re-encryption process.

## Idempotency and failure handling

- `send_events` has a unique `(campaign_id, contact_id)` constraint.
- PayPal order IDs are unique.
- Capture updates only orders still in `created` state.
- Queue retries use the same contact/campaign identity.
- Credits are refunded for messages that fail before being queued.

A future version should add a reconciliation job for rare partial failures between D1 and Queue operations.
