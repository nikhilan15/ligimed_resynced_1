# ADR 0003: Opaque server-side browser sessions

- Status: Accepted
- Date: 2026-09-20

## Decision

Use random opaque browser session tokens transported in secure, HTTP-only cookies. Persist only a
cryptographic hash of the token. Sessions support expiry, rotation, revocation, and an assurance
level for future admin MFA.

JWTs are not the default for first-party browser sessions. Token-based integrations can be added
later with a separate credential type and audience.
