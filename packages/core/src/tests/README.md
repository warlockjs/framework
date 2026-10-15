# Tests

Test infrastructure. Provides Vitest setup, HTTP test helpers for making requests against a test server, and a dev server bootstrapper for integration tests.

## Key Files

| File                               | Purpose                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `vitest-setup.ts`                  | Vitest global setup — bootstraps the framework, connects DB, starts HTTP server  |
| `test-helpers.ts`                  | HTTP test helpers — `testGet()`, `testPost()`, `testPut()`, `testDelete()`, etc. |
| `start-http-development-server.ts` | Starts a test HTTP server instance                                               |
| `index.ts`                         | Barrel export                                                                    |

## Key Exports

- `testGet()`, `testPost()`, `testPut()`, `testDelete()`, `testPatch()` — HTTP test request helpers
- `startHttpTestServer(options?)` — boots a test server; `options.port` overrides `http.port` (applied after the internal bootstrap re-reads `.env`, and preflighted via `assertPortIsAvailable()` so a busy port fails with an instruction instead of `EADDRINUSE`). If the resolved `http.port` does not round-trip through `Number()` (e.g. `HTTP_PORT=03999`), it throws rather than silently skipping the preflight. After app modules load and before the late-phase connectors (http, socket) bind, it runs `Application.runStartupValidators()` — the same slot `warlock dev` and the generated production entry run it in — so a validator registered via `Application.onValidateBoot(...)` that rejects aborts the test server's boot too, instead of only being enforced outside tests.
- Vitest setup module (configured via `vitest.config.ts`)

## Dependencies

### Internal (within `core/src`)

- `../bootstrap` — initializes framework for tests
- `../connectors` — starts required connectors
- `../http` — HTTP server instance
- `../http/port-preflight` — `assertPortIsAvailable()` before the test server binds
- `../application` — `Application.runStartupValidators()`, run before the late connector phase
- `../config` — test-specific configuration

### External

- `vitest` — test runner
- `@warlock.js/cascade` — database setup/teardown

## Used By

- Project test files (`src/**/*.test.ts`)
- CI pipelines
