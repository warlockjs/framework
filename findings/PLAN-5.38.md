# 5.38.0 plan — request log, test runtime defaults and application DX (owner-approved 2026-10-25)

From a production multi-site application's field reports and DX recommendations. One release.

- **Request log (already written):** `http.logging.requests` persistent per-request records, devtools history,
  `warlock logs`, MCP `request_log`.
- **Tests:** the HTTP test server closes the web connector's Vite dev server and watchers; worker lifetime with
  per-file isolation is the default for new apps (per-file opt-out, automatic reset of fakes, cache, request
  context and route registry); a guard that keeps unit specs from booting the app; a per-phase boot profile;
  Vitest 5 `clearMocks` default in the upgrade notes and test skills.
- **Build:** chunk names that always change with their bytes (hash after import rewriting, deduplicated identical
  chunks, a collision check against the previous manifest); build-enforced payload budgets; per-build (not
  per-request) route-name and translation work in production.
- **Validation and AI:** optional enums/literals stay optional in `openai-strict` JSON Schema; validation messages
  use translated field labels or humanised names; tool schema checks per provider with token cost; tool-use
  contract helpers (act when asked, retry after a refusal); an agent trace view in devtools.
- **Core tooling:** single-file package skills in `agents-md`; package-manager detection from what installed
  `node_modules`; `warlock upgrade --check`; `warlock inspect --wiring` and a typed capability API; a multi-site
  render smoke in `warlock doctor` and a two-site fixture in the framework suite.
- **Web UX:** page routes never answer raw JSON errors (forbidden, not-found and error pages per site, overridable);
  every 5xx from API routes and middleware is logged like page failures.
- **Models:** fully typed `get()`/`set()`, a check for `model.column` property reads, server-set model fields that
  request schemas omit.
- **Conventions:** `*.client.ts(x)` becomes an enforced client-only boundary next to `*.server.ts`, extended to module
  boundaries; legacy `utils/locales.ts` deprecated with a `doctor --fix` migration and per-feature locale files;
  small types may sit next to their service, barrels optional.
