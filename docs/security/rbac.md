# RBAC foundation

Authorization combines organization-scoped roles with resource ownership and state checks.

```text
authenticated user
  + active session
  + active membership in selected organization
  + required permission
  + resource belongs to or is explicitly shared with that organization
  + operation is valid for current resource state
= allowed request
```

Initial role seeds provide administrator roles for pharmacy, dealer, and transport organizations and
a narrowly scoped LigiMed compliance role. Additional operational roles are added alongside the
workflow that needs them; they are not granted speculative permissions.

Permission constants live in `@ligimed/auth`. Database permission and role seeds consume those
constants so application checks and persisted RBAC data share one vocabulary.

Frontend permission checks control presentation only. Every backend application service must call
the centralized permission and organization-scope policies before accessing protected resources.

PH1.2 onboarding is an intentionally narrow exception to normal business permissions: an
`ONBOARDING` session can reach only pharmacy account and KYC onboarding routes, and only while its
active membership has the `PHARMACY_ADMIN` role. A `FULL` pharmacy member needs either that role or
the `kyc.submit` permission. Every query derives the organization from the resolved server session;
organization IDs in client input are ignored.
