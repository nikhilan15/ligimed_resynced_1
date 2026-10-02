# LigiMed architecture

LigiMed is a TypeScript monorepo with four Next.js applications, one modular Fastify API, one worker
runtime, PostgreSQL, Redis-ready job contracts, and provider-neutral integration boundaries.

```text
pharmacy ─┐
dealer ───┼── HTTPS/REST ── API modules ── PostgreSQL
transport ┤                        │
admin ────┘                        ├── transactional outbox ── worker
                                  ├── private object storage
                                  ├── notification adapters
                                  ├── payment adapters
                                  └── future governed AI processors
```

The API is a modular monolith. Modules own their application services and repositories and expose
explicit interfaces. They do not query another module's persistence directly. This provides
service-quality boundaries without imposing distributed transactions during the MVP.

The four frontends share design primitives, contract types, validation, authentication utilities,
and configuration. Each owns its route tree, navigation, and role-specific user experience.

See the decision records in `docs/architecture/decisions`, the database model in
`docs/architecture/database.md`, API conventions in `docs/api/conventions.md`, and the security
material in `docs/security`.
