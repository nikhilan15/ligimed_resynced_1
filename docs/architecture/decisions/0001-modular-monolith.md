# ADR 0001: Begin with a modular monolith

- Status: Accepted
- Date: 2026-09-20

## Context

LigiMed needs strong domain boundaries and an extraction path for independently scaled services,
but its initial scale and team do not justify distributed transactions or a large operational
microservice footprint.

## Decision

Use one deployable API and one worker runtime. Domain modules expose explicit application
interfaces and do not access another module's repositories directly. Notifications, payments,
object storage, and AI integrations are defined behind provider-neutral interfaces.

## Consequences

The initial system is simpler to operate and test. Module-boundary discipline is mandatory so a
future extraction does not require rewriting domain logic.
