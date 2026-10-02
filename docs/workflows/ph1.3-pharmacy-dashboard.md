# PH1.3 Pharmacy dashboard

Status: implemented and verified on 2026-09-21.

## Scope

This subphase introduces the authenticated pharmacy workspace and its first tenant-scoped dashboard read model. It deliberately does not invent operational data before the Orders, Inventory, Billing, and Notifications modules own those records.

## Access behavior

- The API derives the organization from the authenticated server-side session. No client-supplied organization identifier is trusted.
- A valid pharmacy `ONBOARDING` session receives a limited dashboard containing its KYC status and next action.
- A valid `FULL` session for an active pharmacy must also hold `organization.read`.
- Dealer and other organization types cannot use the pharmacy dashboard endpoint.
- Submitted KYC is shown as awaiting review. This subphase does not add an admin review workflow or activate pharmacies.

## API

`GET /api/v1/pharmacy/dashboard`

The response contains the authenticated user and pharmacy, effective access level, KYC status, and dashboard sections. Metrics owned by unreleased modules use an explicit unavailable contract:

```json
{
  "value": null,
  "available": false,
  "availableIn": "PH1.9 Orders"
}
```

Zero is never used to represent unavailable data.

## UI

`/dashboard` provides a responsive workspace shell, account status, an operational overview, recent-purchase placeholder, and notification placeholder. Future navigation entries are visibly marked `Soon` and are non-interactive until their modules exist.

## Security decisions

- Session validation is performed by the shared browser authentication guard.
- Every dashboard database query binds user, membership, organization, role organization type, session lifetime, and organization state.
- Responses are private and non-cacheable.
- The dashboard response contains no evidence files, secrets, or sensitive credentials.

## Verification

Coverage includes unauthenticated rejection, onboarding status, full access, cross-tenant query tampering, dealer denial, response-schema validation, and rejection of fabricated metric values.
