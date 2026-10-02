# PH1.1 Pharmacy authentication

## Scope and implementation plan

Reuse the Phase 0 OTP/session repositories, browser protection, RBAC seed, shared validation,
Fastify errors and shared UI button. Implement this sub-phase only, then stop for review.

1. Add a pharmacy authentication attempt bound to a pre-authentication browser cookie, a durable
   IP abuse counter, and an explicit onboarding session scope.
2. Expose pharmacy-only request-code, verify-code, membership-selection, session and logout APIs.
3. Register the user, verified phone identity, pending pharmacy and pharmacy administrator
   membership together in PostgreSQL after successful phone verification.
4. Build responsive registration, sign-in, code verification, pharmacy selection and protected
   account screens. Use a narrow same-origin transport proxy; Fastify remains authoritative.
5. Verify validation, abuse controls, replay/concurrency, CSRF, cross-browser and cross-tenant
   denial, session revocation, and desktop/mobile browser workflows.

## Decisions

- Indian mobile OTP uses the existing E.164 validation. No passwords or second auth system.
- Registration never marks a pharmacy verified. Its organization remains PENDING. ONBOARDING
  sessions have no business permissions; only explicitly authenticated account/onboarding routes
  may accept them. FULL sessions still require ACTIVE organizations. Suspended users, memberships
  and organizations are denied. KYC/profile implementation belongs to PH1.2.
- Login and registration requests issue the same challenge response without account-existence
  disclosure. Eligibility errors are returned only after phone verification.
- The OTP challenge and registration inputs are bound to a random HttpOnly pre-authentication
  cookie. Mutations require an exact trusted Origin, JSON and a matching HMAC CSRF token.
- Multi-pharmacy members choose only from their own active memberships after OTP verification.
  The selection grant expires with the challenge and can complete only once.
- The identity, organization, membership, session and success audit are committed transactionally.
  Existing browser sessions are revoked when replaced. Session tokens never enter JSON or web
  storage. All authentication responses are non-cacheable.
- A local development delivery inbox is available through an explicit CLI command. Codes are
  never returned by HTTP or written to operational logs. Production must supply an SMS adapter;
  selecting an unimplemented provider fails startup rather than pretending to send messages.
- The API applies durable identifier and IP limits. With the local Next.js proxy, the observed IP
  is the gateway, so IP quotas are shared. A production gateway needs an explicitly trusted
  client-address configuration before public exposure; arbitrary forwarded headers are ignored.
- OTP consumption precedes account/session completion. If completion fails, the code stays consumed
  and the user must request another code; no replay is possible after a partial failure.

## Deferred

KYC, pharmacy profile editing, operational dashboard, marketplace, ordering, inventory and billing
remain in their requested later sub-phases. Production SMS selection and jurisdiction-specific
onboarding/compliance policy need business configuration before launch.
