# Database foundation

PostgreSQL is the source of truth. Prisma owns schema migrations and the generated type-safe
client. Runtime connections use Prisma's PostgreSQL driver adapter and an explicitly bounded pool.

Phase 0 creates identity, tenancy, organization-scoped RBAC, sessions, OTP challenges, addresses,
audit events, and the transactional outbox. PH1.2 adds the pharmacy-owned profile, versioned KYC
record, and KYC-specific evidence metadata. Product, inventory, order, shipment, payment, reusable
document management, and return tables remain deferred to the phase that owns their finalized
workflow.

## Invariants

- A user can have at most one membership in an organization.
- A role assignment always belongs to a membership.
- A session selects exactly one active membership and organization.
- Session and OTP secrets are stored as hashes.
- Audit and outbox records are append-oriented.
- A pharmacy has at most one operational profile and one selected primary address.
- KYC revisions are unique within a pharmacy. Submitted revisions are immutable to pharmacy users;
  a rejected or expired record produces a new draft revision.
- Every KYC evidence row repeats the owning organization ID and is queried with that scope. Its
  private object key is namespaced under the same organization and protected by a checksum.
- Application services must enforce that a session's membership belongs to its selected
  organization; this is also covered by authorization tests.
- Dealer marketplace data is an explicit public projection. Private addresses and administrative
  dealer records must not be used as an implicit public profile.

## PH1.2 relationships

```text
Organization (PHARMACY) 1 ── 0..1 PharmacyProfile 0..1 ── 1 Address
Organization (PHARMACY) 1 ── 0..* KycRecord (unique revision per organization)
KycRecord               1 ── 0..* KycEvidence
User                     1 ── 0..* created/updated/reviewed KycRecord
User                     1 ── 0..* uploaded KycEvidence
Organization (DEALER)    1 ── 0..1 DealerPublicProfile
```

`KycEvidence` is deliberately not the platform-wide `Document` model. It is the narrow evidence
aggregate needed for onboarding. PH1.13 will introduce generic document management without
changing historical KYC revision ownership.

## Local commands

```bash
docker compose -f infrastructure/docker/compose.yaml up -d
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

The local fallback URL in `prisma.config.ts` exists only for CLI generation and validation.
Production Prisma commands and every application runtime require an explicit `DATABASE_URL`.
