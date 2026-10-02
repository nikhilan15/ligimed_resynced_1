# Pharmacy billing boundaries

Decision: LigiMed supports both **retail sales invoices** and **dealer purchase invoices** as distinct invoice types and workflows. This decision was confirmed by the product owner on 2026-09-27.

## Retail sales

The pharmacy is the seller and its selected customer is the buyer. A sale must snapshot invoice lines, prices, quantities, applicable tax inputs, and any batch/stock movements at the time it is issued. Drafts must not reduce stock. Issuing a sale and reducing batch stock must be one authorized transaction. A corrected or returned sale must be handled through explicit reversal/credit workflows, not destructive edits to an issued invoice.

## Dealer purchases

The dealer is the seller and the pharmacy is the buyer. A purchase invoice must be associated with the relevant procurement order and seller identity. A pharmacy may record receipt of a dealer-issued invoice, but must not fabricate an invoice on behalf of that dealer. Amounts and items should be reconciled against the order and any receipt before they are treated as payable.

## Shared rules

- Use a common invoice identity/status model with an explicit type and separate typed relationships/operations where workflows diverge. Avoid two unrelated invoice-numbering systems or duplicated customer/organization records.
- Persist money in minor units and currency explicitly, as in the existing order model. Never calculate authoritative totals in the browser.
- Keep invoice issuance, payment recording, and settlement separate. A payment status label on an order is not proof of a settled transaction.
- Server-side role, organization, and state checks are mandatory. Issued records and financial events require immutable history and audit entries.
- Tax treatment, invoice numbering requirements, prescription/medicine details, retention, sharing consent, and legally acceptable documents need qualified legal/accounting/compliance review before production issuance. Engineering must not invent these rules.

The current Customers module provides pharmacy-scoped records for future retail sales. It does not issue invoices or send customer messages.

## Implemented operational ledger (2026-09-27)

- The pharmacy Billing workspace records two explicit invoice types. Retail sales require an active customer and one or more in-stock, unexpired batches. The API snapshots the customer name, products, batches, quantities, prices, and pharmacy-entered tax amounts; calculates totals server-side; and deducts stock with SALE ledger movements in the same transaction. A UUID idempotency key makes network retries safe.
- Dealer purchase records require a confirmed-or-later order and the number, issue date, and amounts from an actual dealer-issued invoice. The seller identity is snapshotted and the record is linked one-to-one to the order. Reconciliation is derived from delivery state and order total, never equated with payment.
- Both operations require a live full pharmacy session, role permission, tenant scope, and CSRF token. Records are immutable through the API and audited, with outbox events for later integrations.
- The displayed retail number is an **internal reference**, not a statutory invoice number. Neither workflow generates a GST tax invoice, sends a bill, records payment, or accepts a document attachment. Tax values entered by users are not rate-validated. Returns, reversals/credit notes, original invoice documents, and formal payable/settlement handling must be implemented before production financial use.
- Statutory tax-invoice fields and numbering must be confirmed by qualified Indian tax/legal reviewers against the [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html) and the actual LigiMed business model before enabling external issuance.

## Retail POS workspace (2026-09-27)

- `/billing` is now a stock-backed retail POS with separate medicine search, bill, and customer/summary zones. `/billing/purchases` is the dealer-invoice workflow; `/billing/history` is the immutable record list.
- Search covers current pharmacy batches by medicine name, generic name, manufacturer, catalogue SKU, and batch number, prioritizing earlier expiry. Only unexpired positive-stock batches appear. The UI warns for near expiry and low stock; authoritative eligibility remains in the API transaction.
- The POS supports line quantity, selling price, discount, and user-entered tax amount. Prices, MRP, tax rates, and composition are **not** synthesized from purchase cost or catalogue information. The pharmacy must enter a selling price and confirm tax inputs. The server calculates and persists totals and line discounts.
- Drafts persist in PostgreSQL under the pharmacy organization. They do not reserve stock; the server rechecks customer and batch state when recording a sale. Draft creation, updates, deletions, and finalized sales require full pharmacy authorization and CSRF protection. Cross-tenant draft and customer-history reads are blocked.
- The interface deliberately does **not** mark sales paid or offer live cash, UPI, card, or credit handling. It offers an internal-record print action, not a statutory invoice PDF. External delivery (SMS/WhatsApp/email), refund/credit notes, customer outstanding balance, tax-rate automation, and statutory invoice generation still require implementation and authorized tax/compliance decisions.

## Offline payment records (2026-10-02)

- A separate immutable entry ledger now records pharmacy-reported payments and refunds against either invoice type. It enforces tenant authorization, CSRF, idempotent retries, and payment/refund balance limits in a serialized database transaction, with audit and outbox entries.
- The ledger is not a payment gateway, bank reconciliation, settlement confirmation, or proof of receipt. A recorded refund is a financial note only; it does not reverse stock, issue a statutory credit note, or send money.
- GST data requirements and the release gate are tracked in `docs/compliance/gst-billing-readiness.md`.
