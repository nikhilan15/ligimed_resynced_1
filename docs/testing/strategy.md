# Testing strategy

The foundation uses a layered test strategy:

1. Unit tests cover pure validation, authorization, money/tax rules, state machines, and retry
   policies.
2. API tests use Fastify injection for transport, errors, headers, and authorization behavior.
3. PostgreSQL integration tests will run against a real temporary database; SQLite substitutes are
   not accepted for PostgreSQL behavior.
4. Every tenant-owned module requires explicit cross-organization negative tests.
5. Provider contract tests cover success, rejection, timeout, replay, and idempotency behavior.
6. Playwright covers the four application shells and, later, critical multi-application workflows.

`pnpm check` runs formatting, linting, TypeScript, and unit/API tests. `pnpm build` verifies all
production builds. `pnpm test:e2e` requires Playwright's Chromium installation and starts all four
application development servers.

On Windows hosts where Application Control blocks the downloaded Chromium executable, build the
pinned Linux test image and keep the application servers on the host:

```powershell
$servers = @(
  Start-Process -PassThru -WindowStyle Hidden node -ArgumentList 'apps/pharmacy/node_modules/next/dist/bin/next','start','apps/pharmacy','--port','3000'
  Start-Process -PassThru -WindowStyle Hidden node -ArgumentList 'apps/dealer/node_modules/next/dist/bin/next','start','apps/dealer','--port','3001'
  Start-Process -PassThru -WindowStyle Hidden node -ArgumentList 'apps/transport/node_modules/next/dist/bin/next','start','apps/transport','--port','3002'
  Start-Process -PassThru -WindowStyle Hidden node -ArgumentList 'apps/admin/node_modules/next/dist/bin/next','start','apps/admin','--port','3003'
)
try {
  docker build -f infrastructure/docker/Dockerfile.playwright -t ligimed-playwright-tests:local .
  docker run --rm --init --ipc=host ligimed-playwright-tests:local
} finally {
  $servers | Stop-Process -Force
}
```

The container and project both pin Playwright 1.63.0. `E2E_EXTERNAL_SERVERS` prevents the container
from trying to start Windows application processes, while `E2E_HOST` directs its browser to Docker
Desktop's host gateway. The runner is for these trusted local application shells only. It does not
disable or modify Windows security policy.

Database integration and E2E tests are Phase 0 release gates.
