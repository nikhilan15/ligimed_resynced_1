# PH1.4 Pharmacy marketplace

Status: implemented and verified on 2026-09-21.

## Scope

This subphase introduced the pharmacy-facing directory of verified medicine dealers. PH1.6 subsequently added dealer detail and catalogue browsing.

## Eligibility and privacy

A dealer appears only when all of these conditions are true:

- the organization type is `DEALER`;
- the organization status is `ACTIVE`;
- its latest KYC revision is `VERIFIED`;
- an explicit `DealerPublicProfile` exists.

Marketplace data comes from the public profile projection. Private dealer addresses, memberships, documents, KYC evidence, and administrative records are not exposed.

Only an authenticated pharmacy `FULL` session for an active pharmacy with `organization.read` can access the dealer directory. Onboarding sessions receive no dealer data and the UI explains that activation is required.

## API

`GET /api/v1/pharmacy/marketplace/dealers`

Supported query parameters are `q`, `cursor`, and `limit`. The shared strict schema rejects organization identifiers and unknown selectors. Results use bounded cursor pagination and private, non-cacheable responses.

At the PH1.4 release, dealer cards exposed the public name, verified status, summary, city/state, and declared service areas. PH1.6 added catalogue links.

## UI

`/marketplace` provides:

- a locked activation state for onboarding pharmacies;
- a responsive verified-dealer directory for active pharmacies;
- dealer/location search;
- honest empty states and cursor navigation;
- a non-interactive catalogue notice at the PH1.4 release, replaced by a dealer detail link in PH1.6.

## Verification

The unit contract covers strict queries and verified dealer responses. PostgreSQL integration coverage includes authentication, onboarding denial, visibility rules, public-profile requirements, search, and tenant-selector rejection.

- Prisma schema validation and migration deployment: passed.
- Formatting, linting, TypeScript, unit tests, and all 17 production builds: passed.
- Live PostgreSQL integration suite: 91/91 tests passed.
