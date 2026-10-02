# PH1.5 Admin KYC review and pharmacy activation

This subphase gives an authenticated LigiMed internal compliance reviewer a queue of pending pharmacy KYC submissions. It is the gate that unlocks the existing pharmacy marketplace.

## Workflow

1. An internal reviewer signs in through the separate admin session cookie using OTP.
2. The review queue exposes only pharmacy organizations in `PENDING` status with a latest KYC revision in `SUBMITTED` or `UNDER_REVIEW`.
3. Starting a review changes the latest revision to `UNDER_REVIEW` and writes an audit event.
4. Approval changes the KYC revision to `VERIFIED`, verifies its evidence, activates the pharmacy organization, revokes onboarding sessions, and emits an outbox event.
5. Rejection changes the revision to `REJECTED`, preserves the organization as `PENDING`, records the required reason, and emits an outbox event.

All mutations require a full internal session, the `kyc.review` permission, same-origin/CSRF protection, a current latest revision, and an explicit confirmation in the admin UI. Evidence remains private and is streamed only to an authorized reviewer after checksum verification.

## API surface

- `GET /api/v1/admin/auth/bootstrap`
- `POST /api/v1/admin/auth/otp/request`
- `POST /api/v1/admin/auth/otp/verify`
- `GET /api/v1/admin/auth/session`
- `POST /api/v1/admin/auth/logout`
- `GET /api/v1/admin/reviews/kyc`
- `GET /api/v1/admin/reviews/kyc/:id`
- `GET /api/v1/admin/reviews/kyc/:id/evidence/:evidenceId/content`
- `POST /api/v1/admin/reviews/kyc/:id/start-review`
- `POST /api/v1/admin/reviews/kyc/:id/decision`

## Local development

After the RBAC seed, provision a separate internal reviewer identity with `pnpm admin:provision -- +91XXXXXXXXXX "Local Compliance Reviewer"`. This command is development-only and refuses production. The pharmacy identity must not be reused as an internal reviewer.

## Scope boundary

This subphase does not implement automatic regulatory approval, external regulator integrations, catalogue, ordering, inventory, or payment workflows. Legal/compliance owners must validate the evidence policy and approval obligations before production use.
