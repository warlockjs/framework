# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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

- `lowerStage3Decorators()` — Vite/Vitest plugin that lowers TC39 Stage-3 decorators with esbuild before oxc / the SSR rewrite mangles them; drop it first in a config's `plugins` so model-decorated files load under Vitest 4 / Vite 8.
- `warlock add notifications` — installs `@warlock.js/notifications` (+ the `mail` feature), ejects `config/notifications.ts`, and scaffolds the app-owned `Notification` model + migration into `src/app/notifications/` (idempotent; async queue opt-in).
- Notifications connector — built-in connector (priority `8`, early phase) reads `config/notifications.ts` at boot and passes it to `setNotificationConfig`; lazy-imports `@warlock.js/notifications` (config-gated), so core keeps no hard dependency on it.

### Changed

- `warlock add test` now scaffolds a `vite.config.ts` that includes `lowerStage3Decorators()`, so a fresh project can test decorated models out of the box.
- `warlock add test` `test` / `test:coverage` scripts now run one-shot (`vitest run`) instead of watch mode — CI-safe by default.
- Bumped `@mongez/reinforcements` to 3.3.0

### Fixed

- `startHttpTestServer` now starts early-phase connectors (database, cache, logger, …) before loading app modules, then late-phase (http, socket) after — mirroring dev/prod boot order; fixes a `MissingDataSourceError` when a module's boot side-effect queries the DB at import under the Vitest integration harness.

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

- `herald-connector` and `http-connector` now log a failed boot-time connection at `log.fatal` (was `log.error` / a dev-only console write). A broker connection failure or an HTTP port-bind failure at boot is unrecoverable — `fatal` makes "page on fatal only" alerting clean, aligned with the cascade and cache drivers. The HTTP connector additionally `await log.flush()` before `process.exit(1)` so the fatal entry reaches Sentry/file before the process dies. Disconnect/shutdown failures stay at `error`.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
