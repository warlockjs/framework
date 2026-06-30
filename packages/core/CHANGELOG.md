# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.5.0

### Changed

- dev-server update notice now fires immediately on `warlock dev` — the check is spawned in parallel with server startup instead of awaiting it, so the notice surfaces as soon as npm responds
- raised the update check's npm registry timeout from 2.5s to 30s, so a slow connection no longer drops the notice
- repository lifecycle hooks (`onCreating` / `onCreate` / `onUpdating` / `onSaving` / `onDeleting` / …) now run on `create` / `update` / `delete` — they were defined but never invoked
- `repository.list()` / `all()` now honor the `sortBy`, `sortDirection`, and `purgeCache` options — previously accepted but silently ignored

### Removed

- presigned-upload `maxSize` option — a presigned PUT URL cannot enforce a size cap, so the option was a false guarantee

### Fixed

- `response.sendFile({ filename })` and `response.download()` no longer 500 on non-ASCII file names — the `Content-Disposition` header is now RFC 6266-encoded (a sanitized ASCII `filename` fallback plus an RFC 5987 `filename*=UTF-8''…`), so an Arabic / emoji / UTF-8 download name streams correctly instead of throwing Node's `ERR_INVALID_CHAR`
- local storage paths are contained to their disk root — `../` traversal segments and absolute paths can no longer escape the configured directory
- `storage.putFromUrl` adds SSRF guards — private / loopback / link-local hosts are rejected and the fetched body is size-capped
- S3 / R2 / DigitalOcean Spaces `url()` no longer produces a malformed double-host URL when `urlPrefix` is set
- cloud `deleteDirectory` paginates via the list continuation cursor instead of re-listing the first page
- local-storage metadata cache is invalidated on write / delete — it was serving a stale size / modified-time
- the cloud driver no longer reports a misleading "SDK not installed" error when the AWS SDK is in fact present (driver load race)
- repository `countCached` / `countActiveCached` now cache and return correctly — a `null` cache miss was being returned as the count
- repository `firstCached` / `lastCached` no longer fetch and cache the entire table to return a single row
- repository boolean filters no longer coerce `false` / `0` to `true`
- repository cache keys are now order-independent (stable key serialization)
- router groups restore prefix / name / middleware state via `try/finally` even when the group callback throws
- `router.any()` / `all` routes now match every HTTP verb under the dev server — they previously matched only GET and POST, diverging from production
- the HTTP concurrency limiter releases its slot on every response path (`noContent`, redirect, file, buffer) — a throwing or non-`send` handler no longer leaks a permit and permanently 429s the route
- the cached-response middleware replays a hit through `response.replay()` instead of re-sending an already-sent reply, preserving status and content-type
- `onSent` cache writes in the idempotency and cache middleware are error-handled — a cache-backend failure no longer surfaces as an unhandled rejection
- `X-Forwarded-For` is parsed to its first hop, so IP-filter / rate-limit / idempotency scoping cannot be spoofed with extra header hops
- the `maintenance` middleware allowlist matches request paths that carry a query string
- use-cases run their `after` middleware and broadcast for a `void` handler, and a failed history write no longer fails an otherwise-successful call
- the use-case retry counter reports the correct count on total failure
- the socket connector no longer double-closes the shared HTTP server during graceful shutdown
- the cache connector disconnects its drivers on shutdown — an open Redis connection was left dangling
- generator stubs import `v` / `Infer` from `@warlock.js/seal` (core never re-exported them), so generated models compile and run
- `warlock dev` hot-reloads when a file is emptied or saved with no trailing newline — a stale no-op-change check was silently dropping those saves before they reached HMR

## 4.4.0 - 2026-06-21

### Added

- `Application.onceBooted(cb)` — run a callback once the app is fully booted (fires immediately if already booted)
- `Application.whenBooted()` — promise that resolves with the boot context when the app is fully booted
- `Application.isBooted` — whether the app has finished booting
- `Application.onShutdown(cb)` — run teardown once on shutdown, before connectors stop (mirror of `onceBooted`)
- `Application.isShuttingDown` — whether shutdown has begun
- built-in `/health` (liveness) and `/ready` (readiness) endpoints with a `health` check registry (`health.addCheck`)
- graceful HTTP shutdown — drains in-flight requests on shutdown, bounded by `http.gracefulShutdown.timeout`
- `http.health.*` config to toggle or rename the health endpoints

### Fixed

- connector shutdown no longer reverses the connector list in place (could corrupt order on a repeated shutdown)

## 4.3.0 - 2026-06-21

### Added

- `warlock update` — update every `@warlock.js/*` package in package.json to its latest version (operator preserved), then run the detected package manager's install
- dev-server update notice — `warlock dev` checks npm on start and prints a one-line notice when a newer `@warlock.js/core` is published
- `devServer.checkForUpdates` config flag (default `true`) to toggle the dev-server update notice
- `fetchLatestVersion()` and `isNewerVersion()` registry/version utilities

### Fixed

- `warlock dev --skip-typings` and `--skip-health` long-form flags now work (were silently ignored)

## 4.2.11

### Added

- `lowerStage3Decorators()` — Vite/Vitest plugin that lowers TC39 Stage-3 decorators with esbuild before oxc / the SSR rewrite mangles them; drop it first in `plugins` so model-decorated files load under Vitest 4 / Vite 8.
- `warlock add notifications` — installs `@warlock.js/notifications` (+ the `mail` feature), ejects `config/notifications.ts`, and scaffolds the app-owned `Notification` model + migration (idempotent).
- Notifications connector — a built-in, config-gated connector that lazy-imports `@warlock.js/notifications`, so core keeps no hard dependency on it.

### Changed

- `warlock add test` now scaffolds a `vite.config.ts` that includes `lowerStage3Decorators()`, so a fresh project can test decorated models out of the box.
- `warlock add test` `test` / `test:coverage` scripts now run one-shot (`vitest run`) instead of watch mode — CI-safe by default.
- Bumped `@mongez/reinforcements` to 3.3.0

### Fixed

- `startHttpTestServer` now starts early-phase connectors (database, cache, logger, …) before app modules, then late-phase (http, socket) after — mirroring dev/prod boot order; fixes a `MissingDataSourceError` under the Vitest integration harness.

## 4.2.5

### Added

- `warlock add notifications` now scaffolds the in-app read/dismiss HTTP surface — `routes.ts` + a `notifications.controller.ts` (list / unread-count / mark-read / mark-all-read / clear / delete), gated by `authMiddleware` and recipient-scoped via `inApp`. Pulls `@warlock.js/auth`.

## 4.2.4

### Fixed

- Fix the worker-loader path in the build entry points — a wrong path in 4.2.3 left the worker entry broken (and blocked the 4.2.3 publish for some packages).

## 4.2.3

### Fixed

- Add the worker scripts as build entry points so they ship in the published package.

## 4.2.2

### Fixed

- Add `cli/start` to the build entry points so the `warlock` CLI entry ships in the published package.

## 4.2.1

### Fixed

- Ship the `bin` folder so the `warlock` CLI works from the published package — it was omitted from the 4.2.0 build.

## 4.2.0

### Changed

- `herald-connector` and `http-connector` now log a failed boot-time connection at `log.fatal` (was `log.error`) — an unrecoverable broker connection or HTTP port-bind failure makes "page on fatal only" alerting clean; the HTTP connector flushes logs before `process.exit(1)`. Disconnect / shutdown failures stay at `error`.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
