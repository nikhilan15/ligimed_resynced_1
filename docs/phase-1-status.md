# LigiMed Phase 1 status

Updated: 2026-10-02

## Document & Compliance Center — 2026-10-02

- Pharmacy Documents is enabled with private uploads, business/banking metadata, search and group/
  status filters, renewal alerts, review history, and immutable replacement versions.
- Existing KYC, orders, sale/purchase bill records and offline payment/refund entries appear without
  duplicated records. Order/billing pages expose linked document trails and PDF exports.
- Admin Documents supports start review, verify, reject/request re-upload, immutable review history,
  configurable expiry windows, and a manual reminder scan. Initial KYC/activation stays in its
  established review workflow.
- Banking/finance grants, masked metadata, tenant-safe links, CSRF, content signature/size validation,
  checksummed private downloads, audit and durable reminder/outbox deduplication are implemented.
- Local migrations `20261002140000_document_center` and `20261002143000_document_kyc_reminders`
  are deployed, and RBAC has been seeded. 16 document integration tests passed.
- Production storage/scanning, email/SMS event delivery, supervised job deployment, statutory tax
  invoice generation and legal acceptance/retention decisions are not claimed complete.
- Full workflow and release boundaries: [Document center](workflows/pharmacy-document-center.md).

This file follows the master project specification supplied on 2026-09-27. Earlier internal
milestone numbers for dealer onboarding and catalogue publication are retained in their workflow
documents, but the master roadmap below is the source of truth for delivery reporting.

## Completed subphases

- PH1.1 pharmacy authentication
- PH1.2 pharmacy profile and versioned KYC submission
- PH1.3 pharmacy dashboard foundation
- PH1.4 verified dealer marketplace directory
- PH1.5 dealer detail and catalogue browsing
- PH1.6 product search and filters
- PH1.7 single-dealer cart with server-side quantity and minimum-order validation
- PH1.8 checkout with persisted address snapshot, explicit payment method, and server-calculated totals
- PH1.9 pharmacy and dealer order views with tenant-scoped status history

## PH1.5 verification matrix

| Area                            | Implementation                                                  | Verification                                                                   |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Separate internal admin session | Google Sign-In, separate cookie, full-session permission check  | Build/typecheck passed; dedicated end-to-end test pending                      |
| KYC review queue                | Latest pending pharmacy and dealer revisions                    | Dealer detail/approval integration test passed; queue paging test pending      |
| Review lifecycle                | Submitted → under review → verified/rejected                    | Dealer approval integration test passed; rejection integration test pending    |
| Pharmacy activation             | Approval activates organization and revokes onboarding sessions | Local approval and pharmacy sign-in passed; dedicated integration test pending |
| Evidence privacy                | Authenticated streaming with checksum verification              | Dedicated integration test pending                                             |
| Audit/outbox                    | Review actions are audited and emit domain events               | Dealer approval audit and outbox integration assertions passed                 |
| Admin UI                        | Login, queue, detail, explicit approve/reject confirmation      | Local approval walkthrough passed                                              |

PH1.6 verification on 2026-09-22: migration deployed, `pnpm check` passed, 92 live PostgreSQL integration tests passed, and all 17 production builds passed. Dealer publication and product management are future subphases, so a verified dealer without published listings shows an empty catalogue.

## PH1.7 verification

- Dealer portal at `http://localhost:3001`: Google registration/sign-in, account state, profile draft, private KYC evidence upload, submission and status. Phone-only legacy accounts still need explicit identity linking.
- Shared partner authentication and KYC services preserve separate pharmacy/dealer session cookies and enforce role and organization type server-side.
- Admin review at `http://localhost:3003/reviews` now handles both pharmacy and dealer submissions. Approval activates the dealer, revokes onboarding sessions, audits the decision, and emits an outbox event.
- The pharmacy marketplace remains empty until a dealer is both approved and has a public profile. Approval alone does not publish a medicine catalogue.
- Local migration `20260922110000_partner_onboarding` was applied on 2026-09-22. `pnpm check`, 93 live PostgreSQL integration tests, and all production builds passed.
- Evidence category and acceptance policy still require qualified legal/compliance review before production. SMS and object storage still use development-only adapters locally; production adapters are not configured.

## PH1.8 verification

- Active dealers with full sessions and the `catalogue.manage` permission can create and update
  their own catalogue listings. Every mutation is tenant-scoped, audited, and emits an outbox event.
- Shared medicine records capture name, generic name, strength, dosage form, pack size,
  manufacturer, category, and dealer-supplied description. Dealers own price, SKU, minimum quantity,
  and availability through their listing; one dealer cannot edit another dealer's listing.
- Active pharmacies can search a verified dealer's available catalogue by text, category,
  manufacturer, and dosage form, then open a database-backed medicine detail page.
- Canonical product metadata is not editable through listing updates. This prevents one dealer from
  silently changing metadata used by other dealers; governed master-data workflows can be added
  separately if required.
- Verification on 2026-09-23: `pnpm check` passed and 95 live PostgreSQL integration tests passed,
  including catalogue RBAC, CSRF, tenant isolation, audit, publication, updates, filters, and details.
  All 18 production build tasks passed.

## Master PH1.7-PH1.9 verification

- A pharmacy cart is persisted in PostgreSQL and limited to one dealer at a time. Listing
  availability, active dealer/KYC state, minimum quantity, currency, and canonical product state
  are revalidated on every mutation and again at checkout.
- Checkout uses the pharmacy's persisted primary address, snapshots medicine and address data into
  the order, creates the initial `PENDING` history entry, deletes the cart atomically, audits the
  action, and emits an outbox event.
- Cash on delivery and bank transfer are recorded explicitly. Online payment is disabled in the UI
  until a production provider is configured. Tax and delivery charges remain zero and are labelled
  unconfigured; no tax, pricing, delivery, or pharmaceutical rule has been invented.
- Pharmacy users can list, inspect, and cancel their own pending orders. Dealer users can only read
  and transition orders belonging to their organization. Status transitions are server-enforced and
  concurrency-protected.
- Validation and integration coverage includes CSRF, RBAC, tenant isolation, cart conflicts,
  minimum quantity, checkout snapshots, audit/outbox records, cancellation, and dealer status
  transitions.

## Current master-roadmap position

**PH1.10 Inventory** has a frontend, backend, database migration, RBAC permissions, batch ledger,
expiry views, stock adjustments, and low-stock thresholds. The migration is deployed locally.
The user requested that full regression verification be deferred until feature coding is further
along.

The pharmacy **Customers** module now has an additive migration, pharmacy-only read/manage
permissions, tenant-scoped API, audit records, and a page for search, create, edit, archive, and
restore. Its migration and RBAC seed are deployed locally; compile checks passed. A full
authenticated browser walkthrough and cross-tenant integration suite remain pending. Customer
contact details are not verified or automatically used for messaging.

Statutory billing issuance, bill sharing, general documents, payments, notifications, settings, support,
production dashboard analytics,
transport, payment settlement, production SMS/object storage, the final security review, and
external legal/compliance sign-off remain incomplete. Legal/compliance acceptance cannot be
self-certified by engineering and requires an authorized professional reviewer.

The product owner chose both retail customer sales invoices and dealer purchase invoices as
separate billing workflows. Their boundaries are recorded in
`docs/architecture/pharmacy-billing-boundaries.md`.

The pharmacy Billing workspace now has two persisted, tenant-scoped operational ledgers: customer
sales (with atomic batch stock deduction and idempotent retry handling) and dealer purchase
invoice records (linked to orders with delivery/amount reconciliation). The additive migration
`20260927180000_pharmacy_billing` and RBAC seed were applied locally. Four focused live-PostgreSQL
integration tests passed for CSRF, stock mutation, retry safety, tenant isolation, and purchase
reconciliation. The full integration suite passed (104 tests), as did the 18-task production build,
full lint, and full typecheck. Authenticated browser checks remain pending. The full `pnpm check`
command is not green because three pre-existing global CSS files need Prettier formatting. These
records are **not** statutory tax invoices; tax compliance, document attachment, bill sharing,
corrections/returns, payment and settlement are not complete.

The retail Billing page was upgraded to a desktop-first POS with live batch search, customer lookup/quick add and purchase history, batch-aware bill lines, discount/tax/total calculation, persisted draft bills, recent bills, and an internal-record print option. Dealer purchase invoice entry moved to `/billing/purchases`; history is at `/billing/history`. Migration `20260927200000_retail_bill_drafts` was deployed locally. The targeted billing integration suite passes five tests, including draft tenancy and discount accounting; the full integration suite passes 105 tests, and the updated production build passed all 18 tasks. An authenticated visual walkthrough is still pending. No payment, statutory invoice PDF, or customer message is generated by the POS.

On 2026-10-02 the pharmacy invoice detail page gained a tenant-scoped, immutable **offline payment and refund entry ledger**. Migration `20261002120000_invoice_payment_entries` was applied to the local database. Entries are self-reported financial records, not gateway charges, bank settlement, statutory credit notes, or stock returns. Six focused live-PostgreSQL billing tests, all 106 integration tests, targeted lint/typechecks, and the 18-task production build pass. GST readiness is documented in `docs/compliance/gst-billing-readiness.md`; statutory invoice issuance remains disabled pending seller-specific GST data and qualified review. Email/PDF bill sharing, tax-rate automation, gateway payments, and credit-note/stock-return workflows are not yet complete.
