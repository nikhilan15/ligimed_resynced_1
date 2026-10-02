# PH1.6 Dealer detail and catalogue

Status: implemented and verified on 2026-09-22.

## Scope

An active pharmacy with a full session can open a verified dealer from the marketplace, read its public profile, and browse its published catalogue. Listings come from PostgreSQL. Empty catalogues remain empty until a dealer publishes products in a later workflow.

## Visibility

Dealer detail and catalogue are returned only while the dealer organization is active, has a public profile, and its latest KYC revision is verified. A suspended dealer or a dealer with newer unverified KYC is hidden immediately. Product listings must belong to that dealer, be available, and reference an active product. The response excludes private organization records, evidence, memberships, inventory quantities, and unpublished listings.

Pharmacy requests require an active pharmacy organization, an active membership, a full session, and `organization.read`. Onboarding sessions receive no dealer data.

## Data model

- `Manufacturer` and `ProductCategory` are reusable catalogue references.
- `Product` holds shared medicine identity and descriptive fields.
- `DealerCatalogueItem` binds one product to one dealer, with its SKU, price in integer minor units, currency, minimum quantity, and publication state.
- The database enforces nonnegative price and positive minimum quantity.

These models do not claim regulatory status, stock availability, batch provenance, or ordering capability. Those workflows require separate implementation and compliance review.

## API and UI

- `GET /api/v1/pharmacy/marketplace/dealers/:dealerId`
- `GET /api/v1/pharmacy/marketplace/dealers/:dealerId/catalogue?q=&cursor=&limit=`
- `/marketplace/dealers/:dealerId`

Catalogue search covers product name, generic name, and manufacturer. Query validation is strict and pagination is bounded. The directory links to each dealer's catalogue.

## Verification

- Prisma migration deployed to local PostgreSQL.
- `pnpm check`: formatting, lint, typecheck, and unit tests passed.
- `pnpm test:integration`: 92 tests passed, including dealer visibility, authorization, tenant-scoped listings, search, and inactive product exclusion.
- `pnpm build`: all 17 packages passed.
