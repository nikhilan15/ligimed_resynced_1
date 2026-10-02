# ADR 0002: Organization-scoped tenancy and authorization

- Status: Accepted
- Date: 2026-09-20

## Decision

Users obtain permissions through active memberships in organizations. Tenant-owned resources are
explicitly related to an organization, and backend policies enforce both permission and resource
scope. Frontend checks are never authoritative.

Cross-tenant negative tests are required for every protected resource module.
