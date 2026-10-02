# Pharmacy inventory, batches, and expiry

Status: frontend and backend implemented on 2026-09-27; full regression verification deferred.

- Inventory is isolated by pharmacy organization and canonical product.
- Stock is stored per batch with batch number, quantity, purchase price, manufacture date, expiry
  date, and receipt date.
- Every receipt and manual adjustment creates an immutable stock movement with the resulting
  balance and actor.
- Database constraints prevent negative stock, invalid dates, duplicate batch numbers per product,
  and zero-value movements.
- Stock adjustments lock the batch row and reject operations that would create negative stock.
- Pharmacy users can filter all, low-stock, near-expiry, and expired records from `/inventory`.
- Reorder thresholds are pharmacy-specific. Near expiry currently means within 90 days and is an
  operational display rule, not a pharmaceutical or legal requirement.
- Mutations require full active-pharmacy sessions, CSRF protection, `inventory.manage`, tenant
  predicates, and audit logging.
