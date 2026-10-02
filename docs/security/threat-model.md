# Phase 0 threat model

## Protected assets

Accounts, organization memberships, KYC documents, pharmaceutical commercial data, orders,
payment records, settlement data, secrets, and audit evidence.

## Primary threats and controls

| Threat                    | Foundation control                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Cross-organization access | Server-side permission and ownership policies; negative tests                            |
| OTP guessing or flooding  | Expiry, attempt limits, cooldown and rate-limit design                                   |
| Session theft             | Random opaque tokens, hashed storage, secure cookies, rotation and revocation            |
| CSRF                      | SameSite cookies, origin allowlist, and mandatory CSRF control before mutation endpoints |
| Credential leakage        | Validated environment configuration and log redaction                                    |
| Malicious documents       | Private storage, allowlists, checksums, and scan-state design                            |
| Webhook forgery/replay    | Raw-body signatures, provider-event uniqueness, idempotent handling                      |
| Privileged admin misuse   | Explicit permissions, MFA readiness, audit trail, break-glass policy                     |
| Lost asynchronous work    | Transactional outbox, retry policy, and dead-letter design                               |
| Dependency compromise     | Pinned lockfile and reviewed lifecycle-script allowlist                                  |

## Phase 0 exclusions

There are no business mutation endpoints yet. Before the first OTP or organization mutation route,
CSRF protection, persistent rate limiting, database-backed challenge handling, and end-to-end abuse
tests are mandatory.
