# ADR 0005: Explicit dealer public marketplace projection

Status: accepted on 2026-09-21.

## Context

Pharmacies need marketplace information about verified dealers, while dealer addresses, memberships, KYC evidence, and administrative records are private. Treating existing organization data as implicitly public would make future fields easy to leak accidentally.

## Decision

The marketplace reads dealer-facing business information from a dedicated `DealerPublicProfile`. A dealer is visible only when its organization is active, its latest KYC revision is verified, and the public profile exists.

The pharmacy marketplace endpoint exposes an allow-listed response contract. It does not serialize organization or KYC records directly. Catalogue counts remain unavailable until the catalogue aggregate owns that data in PH1.5.

## Consequences

- Public marketplace fields are intentionally opt-in.
- Suspending a dealer or changing its latest KYC state removes it from discovery immediately.
- Dealer onboarding or an authorized internal workflow must create and maintain the public profile in a later dealer/admin phase.
- New public fields require an explicit schema and API-contract change rather than becoming visible automatically.
