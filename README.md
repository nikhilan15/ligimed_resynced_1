# LigiMed

LigiMed is a multi-organization pharmaceutical supply-chain platform for pharmacies,
dealers, transport partners, and LigiMed operations.

The repository has completed its Phase 0 foundation and is implementing Phase 1 in bounded
modules. Pharmacy onboarding, admin review, marketplace browsing, and dealer onboarding are
available locally. Ordering, inventory, billing, transport, and payments are not yet implemented.

## Prerequisites

- Node.js 24.11 or newer on the Node 24 release line
- pnpm 11.19 or newer on the pnpm 11 release line
- PostgreSQL and Redis, preferably through Docker Compose

Docker configuration is included for local development, but Docker is not installed
automatically by this repository.

## Commands

```bash
pnpm install
pnpm check
pnpm build
pnpm dev
```

Architecture and operational documentation lives in [`docs`](./docs).
