# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

- `lowerStage3Decorators()` — shared Vite/Vitest plugin that lowers TC39 Stage-3 decorators with esbuild before oxc / the SSR rewrite mangles them. Drop it first in a config's `plugins` so model-decorated files load under Vitest 4 / Vite 8.
- `warlock add test` now scaffolds a `vite.config.ts` that includes `lowerStage3Decorators()`, so a fresh project can test decorated models out of the box.
- `warlock add test` `test`/`test:coverage` scripts now run one-shot (`vitest run`) instead of watch mode — safe for CI by default.
- `startHttpTestServer` now starts early-phase connectors (database, cache, logger, …) **before** loading app modules, then late-phase connectors (http, socket) after — mirroring the dev/prod boot order. Fixes a `MissingDataSourceError` when a module's `main.ts` boot side-effect queries the DB at import time under the Vitest integration harness.
- `warlock add notifications` — new feature in the `add` command: installs `@warlock.js/notifications` (and pulls the `mail` feature for the default mail channel), ejects `config/notifications.ts` (mail + in-app channels wired), and scaffolds the app-owned `Notification` model + a timestamped migration into `src/app/notifications/`. Re-running is idempotent (the model file is the sentinel — no duplicate migration). The async queue stays opt-in (commented in the config; enable with `warlock add herald` + `heraldQueue()`).
- **Notifications connector** — a built-in connector (priority `8`, early phase) reads `config/notifications.ts` at boot and hands its default export to `setNotificationConfig`. `@warlock.js/notifications` is lazy-imported (gated on the config's presence), so core keeps no hard dependency on it — the same pattern as the herald connector. Config files stay declarative (`export default config`); the side-effect moves out of the config file.

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
