# Cart, checkout, and order workflow

Status: implemented for the Phase 1 pharmacy/dealer workflow on 2026-09-27.

## Boundaries

- A cart belongs to one pharmacy and one dealer.
- A pharmacy can have at most one active cart.
- Cart, order, and history access is scoped on the server to the authenticated organization.
- Catalogue prices use integer minor currency units. The API never accepts totals from the client.
- Orders snapshot medicine identity, price, quantity, and shipping address so later catalogue or
  profile edits do not rewrite transaction history.

## Checkout transaction

1. Authorize the pharmacy session with `order.create`.
2. Lock the pharmacy and cart rows.
3. Revalidate pharmacy, dealer, KYC, listing availability, minimum quantities, product activity,
   and currency.
4. Load the persisted pharmacy primary address.
5. Recalculate all line totals and the order total on the server.
6. Create the order, immutable order items, and initial `PENDING` history record.
7. Delete the cart, create an audit record, and publish an outbox event in the same transaction.

## Payment and pricing boundary

`CASH_ON_DELIVERY` and `BANK_TRANSFER` can be selected and persisted. `ONLINE` is reserved in the
schema and payment-provider interface, but it is not exposed as an active checkout option until a
provider, webhook verification, idempotency, and reconciliation workflow are configured.

Tax and delivery charges are stored separately. They currently remain zero and explicitly
unconfigured because validated tax and logistics rules have not been supplied. Production rollout
requires finance, tax, legal, and operational approval of those rules.

## Status lifecycle

```text
PENDING -> CONFIRMED -> PREPARING -> PACKED -> DISPATCHED -> IN_TRANSIT -> DELIVERED
   |           |            |
   |           +----------> CANCELLED
   +-> CANCELLED
   +-> REJECTED

DELIVERED -> RETURN_REQUESTED -> RETURNED
```

The current dealer UI supports the forward fulfilment transitions. Return initiation and approval
are reserved in the status model for a later bounded returns workflow and are not presented as a
completed feature.

## Security properties

- Cookie sessions and CSRF protection are required for mutations.
- RBAC is enforced in the API, never inferred from frontend navigation.
- Tenant predicates are included in every cart and order query.
- Status changes are row-locked and checked against an allow-list.
- Successful mutations write audit logs and order events use the transactional outbox.
