# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.11.0

### Added

- `startHttpTestServer({ port })` — run an integration suite on an explicit port, honoured over `HTTP_PORT` in `.env`, which the internal bootstrap re-reads and no caller could previously override
- the test server preflights its port and fails with "stop the dev server" naming the port, instead of a raw `EADDRINUSE` from inside Fastify
- `Application.setServedPort()` and a `port` field on the readiness signal, so a supervisor learns the bound http port from the app rather than re-deriving it from config it may not be able to read
- `setConfig(name, value)` — the write side of the config store, exported separately from the read-only `config` accessor so registering configuration stays a deliberate boot-time act

### Changed

- `@mongez/dotenv` is now required at `^1.3.1` (was `^1.2.4`). Under the old range a fresh install resolved to 1.3.x while an existing lockfile could stay on 1.2.x, so we could not say which behaviour a given consumer actually had. 1.3.x only changes cases that were previously wrong: `env()` now consults `process.env` instead of returning a default for a key the environment defines, `${VAR}` interpolation throws naming the key instead of baking the string `"undefined"` into a value, and numeric coercion no longer corrupts values like `0123456789` or IDs beyond 2^53. Precedence between `.env` files and injected variables is unchanged

  Core keeps its own guard for a missing `.env` regardless of which version resolves — an application can pin its own transitive dependencies, so the installed version is never something core can assume

### Deprecated

- the `env` preloader flag on a CLI command is no longer read — env is loaded for every command that declares a preload block. Setting it is harmless and does nothing; remove it. Dropped at 5.0

### Fixed

- **A production bundle no longer imports a package your app does not declare.** `warlock build`'s generated config loader emitted `import config from "@mongez/config"` — one of *core's* dependencies, never the app's. npm and yarn hoist flat so it resolved by accident; under pnpm's strict layout the shipped bundle died at boot with `ERR_MODULE_NOT_FOUND` for a package the app had no reason to install. The generator now emits `setConfig` from `@warlock.js/core`, which the app does declare, and Node resolves `@mongez/config` from core's own install — correct under pnpm, and portable, unlike baking absolute paths into an artifact meant to be copied between machines

  **The rule is now enforced, not just followed.** `warlock build` fails if any specifier written into generated code is missing from the app's `dependencies`, listing every violation at once. Rewriting the one bad import fixes today's bundle; the check is what stops the next change to the generator from reintroducing it invisibly — under npm and yarn the mistake never surfaces

  Two scaffolding sites had the same defect and are fixed with it: `warlock generate.module` emitted `groupedTranslations` from `@mongez/localization`, and the communicators config stub emitted `env` from `@mongez/dotenv`. Both now come from `@warlock.js/core`, which already re-exports them

- **`env()` inside `warlock.config.ts` no longer always returns its default.** The config module was evaluated *before* any `.env` file was read, so a project following the documented `build: { outdir: env("BUILD_OUT", "dist") }` recipe silently got `dist` no matter what the environment said — under every command, `dev` included, and under `build` and `start` env was never loaded at all. Env files are now loaded before `warlock.config.ts` is evaluated, for every command

  Loading is guarded: a project with no `.env` is legitimate and must not start failing `warlock build` now that env loads everywhere. `NODE_ENV` remains authoritative for which file is chosen — no command forces the environment, so a deliberate `NODE_ENV=staging` build still reads `.env.staging`. With `NODE_ENV` unset, plain `.env` is read

- **An application without `src/config/storage.ts` can boot again.** The storage connector starts unconditionally, on the documented grounds that `storage.init()` falls back to a built-in `local` driver so file storage works out of the box. That fallback was never implemented: `init()` resolved the default driver *name* and then found nothing registered under it, so any app without a storage config died at boot with `Storage driver "local" is not configured`. A built-in `local` driver rooted at `uploadsPath()` is now registered before configured drivers — so an app defining its own `local` still overrides it, and naming a driver that genuinely does not exist still fails loudly

  Only scaffolded apps hid this, because `create-warlock` always ships a storage config

- `startHttpTestServer` no longer breaks a suite that configures `http.port: 0`. `0` is the OS's "pick a free port for me" idiom, but the guard only checked `typeof port !== "number"`, so `0` fell through: the preflight bound an unrelated ephemeral port and passed without proving anything, and `0` was then published as the bound port, pointing every request in the suite at `http://host:0`. An explicit `0` now takes the same path as no configured port — no preflight, nothing published, Fastify picks the port

- **`warlock start` no longer claims success before the app has booted.** The startup banner printed in `preAction` — before the child process was even spawned — and the failure that followed went only to stderr. Any CI gate or process supervisor that watches stdout for the banner read a 🔴 boot failure as a healthy start, which is how a production app that never booted was recorded as running. The banner now prints only when the application reports a completed boot, and a child that dies before reporting is a failed start: the message goes to **both** stdout and stderr, and the exit code is forced non-zero even when the process itself exited `0`

  Readiness is signalled, never assumed. `Application.markBooted()` sends a versioned `warlock:ready` message — `{ type, version, pid, at, environment, runtimeStrategy, bootDurationMs?, port? }` — over the IPC channel `warlock start` opens, and closes that channel immediately so an open handle can't keep a wedged process looking alive. The signal is gated on a `WARLOCK_BOOT_SIGNAL` handshake the CLI sets on the child it spawns, so an app running under pm2 or any other supervisor never writes into a channel it does not own

  A bundle built by an older Warlock has no readiness signal. It still starts normally and draws a note on **stderr only** telling you to re-run `warlock build` — an absent signal is never an error, never fails a run, and never kills a slow boot

  **Upgrading:** re-run `warlock build` so the bundle can report readiness; until you do, `warlock start` runs your app but prints no started banner. Anything parsing `warlock start` output should note that progress lines now go to stderr — stdout carries the started banner and start failures, nothing else

## 4.10.0

### Changed

- **`response.cookie` is now secure by default** — `httpOnly: true`, `sameSite: "lax"`, and `secure: true` outside development are applied unless overridden. Previously nothing set them: a cookie was readable by any injected script, sent in cleartext, and attached to cross-site requests unless the developer knew to pass three flags on every call. Nothing failed when they were missing, so the app worked and was simply insecure. Precedence is framework defaults → `http.cookies.options` → the per-call argument, so opting out stays possible and explicit. `secure` is relaxed only in development, because browsers drop a `Secure` cookie over plain http

  **Upgrading:** a cookie your client-side JavaScript reads now needs `{ httpOnly: false }` stated explicitly. Anywhere you wrote `secure: Application.isProduction` by hand can be deleted — the default already tracks the environment, and the hand-written form wrongly disables `secure` in test and staging

## 4.9.2

### Fixed

- the dev server's generated `.warlock/loader-hook.mjs` no longer ships bare `esbuild` / `get-tsconfig` imports. That file is written into the **consuming app's** directory, so a bare specifier resolves from the app — but both packages are core's own dependencies. npm and yarn hoist flat so it worked by accident; under pnpm's strict layout the dev server died with `ERR_MODULE_NOT_FOUND` for a package the app never imported. Each npm specifier is now rewritten at generation time to an absolute path resolved from core's own install, so no consumer has to declare a phantom dependency

## 4.9.0 - 2026-08-06

### Added

- `warlock dev` keyboard shortcuts — `r` restart, `c` clear, `q` quit, `h` help — armed once the server is ready and listed by `h`. TTY-gated, and `Ctrl+C` keeps working while raw mode is held
- press `u` on the `warlock dev` update notice to update every `@warlock.js/*` dependency, install, and restart the server in place — no Ctrl+C round-trip. Falls back to the printed `npx warlock update` command when the terminal can't deliver keypresses (CI, piped stdin, supervisors)
- `warlock dev` now runs as a supervised pair — a thin parent that owns the terminal and a disposable worker — so restarting replaces the worker instead of stacking a process per restart, and the supervisor never loads config or connectors
- `warlock dev` restarts automatically when `warlock.config.ts` or any `.env*` changes, since neither can be hot-reloaded; opt out with `devServer.restartOnConfigChange: false` for the previous warning
- Bun support in `warlock update` and `warlock add` — `bun.lock` / `bun.lockb` are detected and drive `bun install` / `bun add`
- `warlock dev` recovers from a crash: a worker that dies after running healthily for 5s is replaced automatically, while one that dies during boot is left alone so its error isn't buried under a reprint. Capped at 3 crashes per minute
- `warlock update --dry-run` reports what would change without touching anything, and `--check` does the same but exits `1` when a package is behind — a CI gate for staying current

### Changed

- the dev-server update check remembers npm's answer for 24h in `.warlock/update-check.json`, so a day of restarts costs one lookup instead of one per boot; failed lookups are never cached, and the entry is dropped once an update is applied

### Fixed

- `warlock start` spawns `process.execPath` instead of a bare `node`, which failed with `ENOENT` wherever `node` is not on `PATH` (systemd units, cron, slim containers) and could otherwise pick a different Node version than the one running the CLI
- `warlock add` no longer carries its own package-manager detection that silently produced an undefined install command when the project had no recognised lockfile — it shares the updater's detection
- `build.outDirectory` — the name the docs have used for several releases — is now actually read. Only `build.outdir` ever was, so a config written from the documentation was silently ignored and the bundle still went to `dist/`. Both names now work (`outdir` wins if you set both) and the docs lead with `outdir`
- `warlock update` no longer reports "All @warlock.js packages are already up to date" when it never reached the npm registry — an offline run now says so and changes nothing
- a failed package-manager install during `warlock update` no longer loses the rewritten `package.json`; the CLI still exits non-zero
- the dev server's update check now uses a 5s abort budget instead of 30s, so a hanging network can't leave a pending request behind a running server

## 4.8.1 - 2026-07-21

### Fixed

- `@warlock.js/ai`, `@warlock.js/access`, and `@warlock.js/notifications` declared as optional `peerDependencies` (matching the existing `@warlock.js/herald` pattern) so pkgist's bundler leaves them external instead of vendoring their source into core's own build — a vendored `@warlock.js/ai` copy was a disconnected module instance whose config listeners (e.g. `ai-panoptic`'s dashboard wiring) never received `ai.config(...)` calls routed through the real, separately-installed package

## 4.6.1

### Fixed

- a fatal `uncaughtException` at production boot (e.g. a config file that throws) is no longer swallowed into a silent `exit 0` — bootstrap now wires the crash handler to exit non-zero in production so `warlock start` surfaces the failure; the dev server still logs-and-continues for HMR

## 4.6.0

### Added

- release-hygiene tests: version↔changelog invariant + generator-stub import check
- `router.routeCount()` exposes the number of registered routes as a boot/readiness signal
- `health.addRoutesRegisteredCheck(getRouteCount)` registers a readiness check that reports not-ready when a booted HTTP app has zero routes
- seeders now receive a `{ track }` context — `track(model)`, `track(models[])`, and `track(table, id)` register created records (each call returns its argument so it can be chained inline); `recordsCreated` is auto-derived from the track count
- `seed_records` table (created via the new `SeedRecordsTableMigration`) records every tracked seed reference within the same transaction the seed runs in; only the last run's refs are kept per seeder
- `warlock seed --drop [name]` undoes a seed: deletes its tracked records in reverse run/insertion order inside a transaction, then resets the matching seeds-log rows so `once: true` seeds re-run; scope to one seeder with `--drop=<name>`
- `Seeder.dependsOn` is now resolved — seeders are topologically sorted so dependencies run before dependents, layered over the numeric `order` tie-break; throws `UnknownSeederDependencyError` for a missing dependency and `SeederDependencyCycleError` for a cycle
- seeders receive an injectable clock and a meaningful batch size — `run({ track, now, batchSize })`; `now()` (default `() => new Date()`) drives both seed data and the seeds-log timestamps so historical/back-fill runs are deterministic, and `batchSize` surfaces the seeder's own `batchSize` for `Model.createMany(rows, { batchSize })`
- repository-level aggregation — `aggregate()`, `sum()`, `avg()`, `min()`, `max()`, and `groupBy()` on `RepositoryManager`, each reusing `filterBy` (and its operator-injection guard), `where`, and scopes before the aggregate, exactly like `count()`
- `warlock doctor` — a read-only diagnostics command that runs routes / config / connectors / optional-peers / health / release-hygiene checks and prints a pass/warn/fail report (exits non-zero on any failure, never opens a DB/cache/socket connection)
- `warlock routes` — a read-only command that lists the registered HTTP routes as a verb-colored table (method / path / name / action / middleware-count / source); filter with `--method` / `--path` / `--name`, or emit the normalized rows as JSON with `--json`. Boots app code to register routes but starts no connectors

### Changed

- `Seeder.run` now receives a `SeedContext` (`run(ctx)`) — backward compatible, an existing zero-arg `run()` keeps working unchanged

### Fixed

- route-module load/registration failures are no longer swallowed: a route file that throws on import or registration now surfaces loudly instead of silently 404'ing the whole surface
- `ModuleLoader.loadModule` rethrows after logging (wrapped in a new `ModuleLoadError` carrying the failing file + cause), so a broken module aborts boot and is caught loudly by the HMR batch-reload handler in dev
- `ModuleLoader.loadAll` aggregates per-file failures and throws an `AggregateError` at the end, so one broken module no longer hides the others
- `router.withSourceFile` rethrows the callback error after logging instead of consuming it with a bare `console.log` (the `try/finally` source-file stack cleanup is preserved)

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
