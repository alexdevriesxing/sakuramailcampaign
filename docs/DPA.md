# Data Processing Addendum Template

> This is a structural template for legal counsel, not a signed or complete DPA.

## Parties and scope

The customer is the controller/business and Sakura Mail is the processor/service provider for personal data uploaded into campaigns, except where law assigns a different role.

## Documented instructions

Sakura Mail processes customer personal data only to host, organize, schedule, transmit, suppress, secure, troubleshoot and delete it according to the service agreement and customer actions, unless law requires otherwise.

## Confidentiality

People authorized to process customer data must be bound by confidentiality and receive access only as needed for their role.

## Security measures

The schedule should include:

- Encryption in transit and recipient-address encryption at rest.
- Tenant-scoped access controls.
- Passwordless authentication, secure sessions and anti-automation controls.
- Audit logging and restricted admin views.
- Backups, incident response, vulnerability management and account MFA.
- Queue retry and suppression enforcement.

## Subprocessors

At minimum, list Cloudflare and PayPal with service purpose, processing location information and a change-notification process.

## Data-subject requests

Sakura Mail will provide reasonable assistance for access, correction, deletion, restriction, portability and objection requests, taking into account the nature of the processing. The customer remains the primary contact for recipients.

## Security incidents

Define a notification period, required information, cooperation process and contact channel. Do not promise a timeline the organization cannot operationally meet.

## Deletion and return

At termination, customer data will be returned or deleted according to documented retention and backup procedures, except where law requires retention. Suppression data may need special handling to avoid re-mailing opted-out recipients.

## International transfers

Specify applicable transfer clauses, supplementary measures and locations after reviewing Cloudflare and PayPal contractual terms.

## Audit

Define documentation, certifications, questionnaires and proportionate audit rights without exposing other tenants or weakening security.
