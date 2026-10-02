# Phase 0 release status

- Status: **COMPLETE**
- Verified: 2026-09-21
- Scope: platform foundation only; no Pharmacy business features are included

## Release-gate matrix

Only `PASS`, `FAIL`, and `BLOCKED` are valid verification states.

| Category            | Test                                                                                               | Status | Evidence                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Project checks      | Formatting, ESLint, TypeScript and workspace unit/API tests                                        | PASS   | `pnpm check`; 23 Turbo tasks passed                                                           |
| Unit tests          | Authorization, OTP crypto, configuration, validation, retry and API behavior                       | PASS   | 28 tests passed across the implemented unit/API suites                                        |
| Production builds   | All applications, services and shared packages                                                     | PASS   | `pnpm build`; 17 packages passed, including four optimized Next.js builds                     |
| PostgreSQL          | Local source-of-truth database connectivity                                                        | PASS   | PostgreSQL 18.6 accepted authenticated connections                                            |
| Database migration  | Initial foundation migration applied                                                               | PASS   | `_prisma_migrations` contains completed `20260920134500_foundation`                           |
| Database drift      | Prisma schema compared with live PostgreSQL                                                        | PASS   | Linux Prisma 7.10 container reported no difference                                            |
| Prisma client       | Schema validation and client generation                                                            | PASS   | Prisma 7.10 validation and generation completed                                               |
| Database seed       | RBAC definitions persisted                                                                         | PASS   | 4 roles, 6 permissions and 15 role-permission mappings                                        |
| Seed idempotency    | Sequential and concurrent reruns preserve the same records and IDs                                 | PASS   | Live PostgreSQL seed integration test passed                                                  |
| Tenant isolation    | Authorized and cross-organization reads for users, memberships, addresses, sessions and audit logs | PASS   | Live PostgreSQL integration suite passed, including HTTP transport cases                      |
| Authentication      | Persisted session resolution derives user, membership, organization and permissions on the server  | PASS   | Session repository integration tests passed                                                   |
| OTP                 | Expiration, attempt limits, rate limits, replay prevention and atomic consumption                  | PASS   | OTP unit and live PostgreSQL integration tests passed                                         |
| Sessions            | Hash-only tokens, expiry, revocation, active-tenant ownership and permission reload                | PASS   | Session unit and live PostgreSQL integration tests passed                                     |
| CSRF                | Trusted Origin plus session-bound HMAC for unsafe cookie-authenticated methods                     | PASS   | Missing, invalid, cross-session and valid token tests passed; safe methods/preflight verified |
| RBAC                | Permission and organization ownership enforcement                                                  | PASS   | Authorization unit tests and PostgreSQL tenant tests passed                                   |
| API security        | CORS, rate limiting, headers, server request IDs, safe errors and log redaction                    | PASS   | 13 API tests passed, including 10 focused security tests                                      |
| Playwright browsers | Pinned trusted Linux browser environment                                                           | PASS   | `mcr.microsoft.com/playwright:v1.63.0-noble` test image built successfully                    |
| Browser smoke tests | Pharmacy, Dealer, Transport and Administration shells                                              | PASS   | 4/4 Playwright tests passed in the Linux container                                            |
| Documentation       | Architecture, security, database, testing and release evidence                                     | PASS   | This matrix and linked foundation documents reflect the verified implementation               |

## Completed foundation

- Seventeen-package pnpm/Turborepo workspace with four Next.js application shells.
- Fastify API with security headers, strict credentialed CORS, rate limiting, OpenAPI, bounded
  readiness probes, server-generated request IDs, safe problem responses and log redaction.
- PostgreSQL/Prisma identity and tenancy foundation: users, identities, organizations,
  memberships, RBAC, OTP challenges, sessions, addresses, audit logs and outbox events.
- Database-backed OTP and opaque session repositories with live PostgreSQL tests.
- Server-derived request context and organization-scoped resource service. Client-supplied roles,
  permissions or tenant context are never authoritative.
- Browser session and CSRF foundation. Authentication mutation endpoints remain intentionally
  unexposed until their Phase 1 workflows are designed.
- Provider-neutral contracts for storage, notifications, payments, workers, OTP delivery and AI.
- Docker tooling for Linux Prisma migrations and Playwright browser execution without weakening
  Windows security controls.

## Security decisions

- First-party browser authentication uses opaque, random server-side sessions. PostgreSQL stores
  only SHA-256 token hashes.
- Session resolution verifies the active user, active membership, active organization, ownership
  relationships, role organization type, expiry and revocation on every request.
- OTP digests are challenge-bound HMACs made with a dedicated secret. Issue and verify operations
  use PostgreSQL transactions and advisory locks for replay and concurrency safety.
- Cookie-authenticated unsafe requests require both an allowlisted Origin and a session-bound CSRF
  token. An arbitrary Authorization header cannot bypass browser protections.
- Production cookies are Secure, HttpOnly, host-only and SameSite=Lax. Production configuration
  rejects development providers, HTTP origins, shared auth secrets and blanket proxy trust.
- Operational logs omit URLs/query strings, headers, bodies, raw exceptions and stacks. Known
  framework rejections retain safe 400, 413, 415 and 429 problem responses.
- No internal-administrator tenant bypass exists. Future cross-organization workflows require an
  explicit permission and audited policy.

## Database decisions

- PostgreSQL remains the source of truth; SQLite and fake repositories are not substitutes for
  integration verification.
- Prisma 7 uses the PostgreSQL driver adapter at runtime. The migration history lives in
  `database/migrations` and deploys with `prisma migrate deploy`.
- The RBAC seed is transactional, serialized for concurrent execution, deterministic and safe to
  rerun.
- Windows Application Control blocks Prisma's downloaded native schema engine. The pinned Linux
  Prisma tool image is the supported local migration path; Windows policy is unchanged.
- Redis is optional in Phase 0 because no implemented cache, queue, session or worker adapter uses
  it. The current general API limiter is process-local, so the verified deployment boundary is one
  API process until a shared limiter is implemented.

## Environment prerequisites

- Node.js 24.11 or newer within major version 24.
- pnpm 11.19 within major version 11.
- PostgreSQL with a configured `DATABASE_URL`.
- Docker Desktop for the Windows-safe Prisma migration and Playwright paths.
- Separate random `OTP_HASH_SECRET` and `CSRF_SECRET` values of at least 32 bytes.

## Reproduce verification

Install and validate the workspace:

```powershell
pnpm install
pnpm db:validate
pnpm db:generate
pnpm check
pnpm build
pnpm test:integration
```

Build the Linux Prisma tool and apply committed migrations from Docker Desktop:

```powershell
docker build -f infrastructure/docker/Dockerfile.prisma -t ligimed-prisma-tools:local .
docker run --rm --env-file .env.docker --mount "type=bind,source=$PWD/database/migrations,target=/workspace/database/migrations" ligimed-prisma-tools:local migrate deploy
pnpm db:seed
pnpm db:seed
```

The development reset command is `pnpm db:reset`. It is destructive and must only target a
verified disposable development database.

For Windows machines where Application Control blocks downloaded Chromium, use the exact pinned
Docker workflow in `docs/testing/strategy.md`. It builds `Dockerfile.playwright`, starts the four
already-built application shells on the host and executes all four smoke tests in Linux.

## Known limitations and deferred choices

- Phase 0 contains no Pharmacy procurement, catalog, inventory, order or payment business feature.
- No public login, OTP or session mutation endpoint is exposed yet. The persistence, transport and
  security controls are implemented and tested for the future identity module.
- SMS, object storage, payment, observability and AI production providers are not selected. Their
  interfaces exist, and provider selection requires separate credentials and contract testing.
- Windows-native Prisma engine and Chromium execution remain blocked by enterprise signing policy.
  Both required release gates were executed in pinned Linux containers instead.
- Pharmaceutical, KYC, privacy, tax and document-retention rules require jurisdiction-specific
  legal and compliance validation before their business modules are implemented.

## Phase 1 decision

All applicable Phase 0 release criteria are verified. Phase 1 may begin as a separate task, one
bounded module at a time, while preserving these security and tenant-isolation controls.
