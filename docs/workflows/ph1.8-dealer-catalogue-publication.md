# PH1.8 Dealer catalogue publication

## Outcome

An approved dealer can publish real PostgreSQL-backed medicine listings in the dealer portal. An
active pharmacy can search and filter those published listings and open a medicine detail page.

## Boundaries

- `Product` owns reusable medicine metadata.
- `Manufacturer` and `ProductCategory` are reusable references.
- `DealerCatalogueItem` owns dealer-specific SKU, price, currency, minimum quantity, and
  availability.
- A dealer listing update cannot modify shared product metadata. This avoids cross-dealer master-data
  corruption.
- Catalogue publication is restricted to active dealer organizations, full sessions, active
  memberships, dealer roles, and the `catalogue.manage` permission.
- Pharmacy reads expose allow-listed public fields only and re-check that the dealer is active with a
  public profile and latest verified KYC revision.

## API

- `GET /api/v1/dealer/catalogue/listings`
- `GET /api/v1/dealer/catalogue/listings/:listingId`
- `POST /api/v1/dealer/catalogue/listings`
- `PATCH /api/v1/dealer/catalogue/listings/:listingId`
- `GET /api/v1/pharmacy/marketplace/dealers/:dealerId/catalogue`
- `GET /api/v1/pharmacy/marketplace/dealers/:dealerId/catalogue/:listingId`

Mutation requests require the dealer session cookie, an allowed origin, a CSRF token, and JSON.
Request contracts are strict and shared through `@ligimed/validation`. Money is transported as an
integer minor-unit string and persisted as PostgreSQL `BIGINT`.

## Verification

The automated suite verifies authentication, activation scope, RBAC, CSRF, strict validation,
cross-tenant denial, publication, updates, auditing, outbox events, public catalogue filtering, and
medicine details. Product information remains dealer-supplied and requires regulatory review before
production use.
