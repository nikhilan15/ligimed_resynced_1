# PH1.2 Pharmacy profile and KYC onboarding

## Delivered scope

1. An authenticated pharmacy administrator can save legal/trade names, operational contact data,
   an authorized representative, and one primary pharmacy address.
2. Saving the profile creates or updates a pharmacy-owned KYC draft. Rejected or expired records
   create a new numbered revision instead of overwriting history.
3. A draft accepts private PDF, PNG, and JPEG evidence up to 5 MB in six neutral categories. The API
   checks media type, basic file signature, size, server-computed checksum, namespace, CSRF, session,
   role/permission, organization ownership, and workflow state.
4. Evidence downloads are authenticated attachments. Draft evidence can be removed. Cross-tenant
   identifiers return not found without disclosing another pharmacy's data.
5. Submission requires a saved profile, primary address, at least one evidence file, and an explicit
   declaration. It locks the revision, appends an audit record, and writes a transactional outbox
   event. Pharmacy submission does not activate or verify the organization.
6. The responsive Next.js screen is available at `/onboarding`; the protected account screen links
   to it. The same-origin BFF forwards only allow-listed paths, methods, and headers.

## API surface

All routes are under `/api/v1/pharmacy/onboarding` and return non-cacheable responses:

- `GET /state`
- `PATCH /profile`
- `POST /evidence`
- `GET /evidence/:evidenceId/content`
- `DELETE /evidence/:evidenceId`
- `POST /submit`

Mutations require the session cookie, exact trusted origin, and matching HMAC CSRF token. The server
derives pharmacy ownership exclusively from the resolved session.

## Verification

- Prisma schema validation and migration deployment: passed.
- Formatting, linting, TypeScript, unit tests, and all workspace production builds: passed.
- Unit coverage added for profile/evidence validation and local private storage.
- Live PostgreSQL integration suite: 83/83 tests passed, including six PH1.2 tests for CSRF,
  privileged-field rejection, tenant isolation, private file access, immutable submission, audit,
  outbox, prerequisites, and revision history.

## Deferred and required decisions

- Admin review, verification/rejection actions, and organization activation belong to the later
  admin/onboarding approval phase.
- Qualified compliance counsel must approve required document types, reference-number validation,
  expiry/re-verification rules, declarations, retention, deletion, and reviewer obligations.
- Production needs a private cloud storage adapter, malware scanning/quarantine, retention policy,
  and recovery/cleanup process. The server rejects local storage in production configuration.
- PH1.3 dashboard work has not started.
