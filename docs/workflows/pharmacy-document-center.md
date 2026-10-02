# Pharmacy Document & Compliance Center

Implemented 2026-10-02. This module manages genuine uploaded evidence and projections of existing
records; it does not certify pharmaceutical compliance, tax compliance, disposal or bank settlement.

## Entry points

- Pharmacy: `/documents`, with details at `/documents/{documentId}`.
- Admin: `/documents`, with document review at `/documents/{documentId}`. Initial pharmacy/dealer
  KYC evidence and organization activation retain the existing `/reviews` workflow.
- Order and billing details link to their document trail and authenticated PDF exports.

## Ownership and sources

`Document` owns private uploaded files and their metadata, never duplicate order/invoice data.
`DocumentReview` is append-only review history. Replacement files have separate IDs and object keys,
with a unique predecessor link. Old versions retain their original bytes and decisions.

The library combines current uploads, evidence from the latest KYC revision, existing purchase
orders, sales/purchase invoice records and offline payment/refund entries. KYC files are not copied.
An invoice attachment derives its order link from the owning invoice; explicit conflicting links
are rejected. Both links are checked against the active pharmacy, not trusted from the browser.

The five groups are business/KYC, banking, transactions, returns and finance. Drug licence metadata
supports reference, type, holder, issue and expiry dates. Authorized-person documents support name
and designation. Banking metadata stores only account last four digits and IFSC, not full account
numbers. PAN, person-KYC and banking references are masked in responses. Finance/banking access
requires a separate `document.finance` grant; these categories are omitted from unauthorized lists
and denied on direct reads and uploads. Sharing controls are disabled for sensitive documents.

## Upload and review

- PDF/JPEG/PNG, non-empty, maximum 5,242,880 bytes. Content signatures and filenames are checked
  server-side using the same utilities as KYC. File type/size checks also run in the browser.
- Metadata is validated centrally in `@ligimed/validation`, including ISO dates, date ordering,
  UUID links, lengths, bank last-four and IFSC format. It is URL-encoded in `x-document-metadata`;
  the header is capped at 8 KB. Raw file bytes avoid base64 expansion.
- Uploads are idempotent within an organization. Conflicting file/metadata retries return 409.
  Failed database writes remove only the new orphan object, never the predecessor.
- Lifecycle: `PENDING_REVIEW → UNDER_REVIEW → VERIFIED / REJECTED`. Rejection requires a reason
  and requests a new upload. Replacement versions start pending review.
- Explicit row locks serialize review/replacement races; expected-status checks prevent a second
  review decision from overwriting the first. There is no original-file edit/delete endpoint.
- Uploaded documents, review decisions, policy changes and downloads are audited. Reviews emit
  transactional outbox events. Separate document verification does not activate the pharmacy.

## Expiry and reminders

Display status includes missing, pending, under review, verified, rejected, expiring soon and expired.
Recorded transaction projections are labelled `RECORDED`, not legally verified. Rejection takes
precedence over expiry display; the underlying review state remains visible in document details.
Date comparisons use the Indian calendar date; a document expires after its stated final date.

Admins configure 1–8 unique reminder windows (1–3650 days), default 90/60/30. Expired reminders use
threshold zero. The API scans on startup and hourly, and admins can run a scan manually. Current
uploads and verified evidence from the latest verified KYC revision participate. A durable unique
constraint deduplicates each source/threshold; the reminder and outbox event commit together.
Missed windows produce the most urgent applicable reminder, not a burst of historical messages.
In-app renewal alerts are computed from current dates, so they do not depend on external delivery.

## Private access and sharing

Every endpoint resolves the live session and checks organization status/type and permissions in
the backend. Mutations require origin validation and CSRF. Files have private no-store responses,
checksum verification, safe attachment headers and `nosniff`. Preview retrieves the same audited
private endpoint and uses an expiring browser blob in a sandboxed iframe. Sharing uses the native
browser file-sharing API; unsupported browsers are told to download and attach the file. There are
no public document URLs, fabricated sent confirmations or silent external email sends.

PDF exports are internal operational projections, explicitly not statutory GST invoices or bank
payment confirmations. Original issuer-supplied GST invoices can be uploaded as evidence.
Return approvals, credit notes, pickup records, finance agreements and settlement statements can
be uploaded and linked now; they are not automatically manufactured from unimplemented workflows.
Delivery confirmation and disposal certification await real authorized workflows and evidence.

## API surface

Pharmacy prefix `/api/v1/pharmacy/documents`:

- `GET /`: search, group/status/source filters, optional order/invoice IDs, pagination.
- `GET /links`: latest 100 eligible order and invoice link choices.
- `POST /uploads`: private raw-file upload plus validated metadata.
- `GET /uploads/:id`: details, review and version history.
- `GET /:source/:id/content`: private original (`upload`, `kyc`) or generated record
  (`invoice`, `order`, `payment`).

Admin prefix `/api/v1/admin/documents`:

- `GET /`, `GET /uploads/:id`, `GET /:source/:id/content` (`upload`, `kyc`).
- `POST /uploads/:id/review`, `PUT /policy`, `POST /reminders/run`.

The Next.js BFFs whitelist paths/methods, cap payloads and preserve private response headers.
Shared permissions: `document.read`, `document.manage`, `document.finance`, `document.review`,
`document.policy`. Existing roles are extended; no second authentication stack was created.

## Release boundaries

- Production private object storage, malware/content scanning and isolated preview infrastructure
  still need configured providers. Signature checks alone are not a malware scanner. Local storage
  remains development-only under the existing environment policy.
- Email/SMS dispatch is not connected to these outbox events. Native browser file sharing and
  visible renewal alerts work without a messaging provider.
- Move the hourly scanner to a supervised job/worker for production availability. Uniqueness
  constraints already make repeated or overlapping scans idempotent.
- Compliance acceptance, retention/deletion policy, required IDs and document validity must be
  approved by qualified advisers. Uploading a category does not assert it is legally required.
- Current mixed-source paging is bounded to 100 pages (up to 50 records/page). Searching narrows
  the full source set. For large histories, replace the bounded merged read with an indexed feed
  projection/cursor; do not increase the bound without profiling.
- Built-in PDF fonts are Latin-oriented; embed approved multilingual fonts before supporting
  statutory or multilingual print documents.

## Verification

16 live PostgreSQL integration tests cover authentication/CSRF, content/metadata validation, upload
retry and concurrent retry behavior, tenant isolation, bank/finance authorization and masking,
private audited downloads, KYC/transaction projections, automatic linking, PDF bytes, review
transitions and conflicts, immutable replacement history, reminder deduplication, policy validation
and revoked sessions. Full checks/build/regression results are recorded in the phase status file.
