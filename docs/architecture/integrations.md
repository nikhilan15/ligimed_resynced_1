# External integration boundaries

External systems are accessed through LigiMed-owned interfaces. Domain modules depend on these
interfaces, not provider SDKs.

## Object storage

Files remain private. PH1.2 uses an API-managed `PrivateObjectStorage` interface and a genuine local
filesystem adapter in development. The API verifies organization namespace, size, SHA-256 checksum,
allowed media type, and basic file signature; downloads are authenticated, tenant-scoped,
non-cacheable attachments. Production configuration already rejects local storage. A cloud adapter,
quarantine/malware scanning, retention policy, and preferably short-lived signed transfers are
required before production availability.

## Notifications

Committed domain work creates an outbox event. A worker turns that event into a versioned template
request and records each delivery attempt. Provider retries use bounded exponential backoff. OTP
delivery is operationally separated from user notification preferences.

## Payments

The provider contract supports intent creation, authoritative status lookup, refunds, and signed
webhook verification. Provider event IDs and internal idempotency keys must be unique in the future
payment schema. Browser redirects are not proof of payment.

The marketplace and dealer-settlement legal model requires payment-provider and professional legal
review before production implementation.

## AI

AI is asynchronous and receives a purpose-limited data projection. Jobs identify organization,
model policy, and prompt version. Results identify provider and model and can require human review.
AI processors never receive unrestricted database access and cannot directly perform financial or
regulated actions.
