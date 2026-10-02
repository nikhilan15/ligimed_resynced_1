# ADR 0004: Versioned KYC with private evidence

- Status: accepted for PH1.2
- Date: 2026-09-21

## Context

Pharmacy onboarding must accept profile data and supporting evidence before a pharmacy is active.
The exact India-specific evidence policy is not legally validated, the production object-storage
provider is not configured, and the general document manager belongs to PH1.13.

## Decision

- Store the pharmacy's operational profile one-to-one with its organization and reference an
  organization-owned primary address.
- Preserve each KYC submission as a numbered revision. Pharmacy users may edit only a draft.
  Submitted and under-review records are locked; a rejected or expired record starts a new revision.
- Store onboarding files as `KycEvidence`, not as a speculative generic document hierarchy. Every
  record carries organization ownership, classification, metadata, SHA-256 checksum, and review
  status.
- Keep files behind `PrivateObjectStorage`. Development uses a path-confined local adapter;
  production must provide a private cloud implementation and malware-scanning workflow.
- Permit permissionless onboarding sessions only through a server-side pharmacy onboarding policy.
  This does not grant general business permissions.
- Emit an outbox event after KYC submission so later admin review and notifications can react
  without coupling them to the write transaction.

## Consequences

Historical submissions and evidence metadata remain auditable. Tenant scoping is explicit in both
database rows and object keys. Admin review, automatic organization activation, evidence policy,
retention, malware scanning, and cloud storage remain separate, required follow-up work.
