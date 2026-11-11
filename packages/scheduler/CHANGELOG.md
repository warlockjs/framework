# Changelog — @warlock.js/scheduler

All notable changes to `@warlock.js/scheduler` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.53.0 - 2026-11-11

### Upgrading

- Jobs still run one at a time by default. What an app can notice: `scheduler:tick` keeps firing while a job runs, and `job:skip` ("Job is already running") is emitted on those ticks for a due job whose run is still going. Apps with long jobs that hold back the others can call `scheduler.runInParallel(true)` (cap with the second argument) when their jobs are safe to run side by side.
- An `onOneServer()` job on a plain interval no longer runs at boot; it first runs at the next wall-clock boundary (`everyHour()` at the top of the hour). Add `.at()` or use `cron()` to pick the exact times, or drop `onOneServer()` for a job that must run at boot.

### Security

- `onOneServer()` did not deduplicate interval schedules: each server computed its tick from its own boot time and from when its last run finished, so every server claimed a different tick and all of them ran the job. A plain interval with `onOneServer()` (`everyMinute()`, `everyHours(2)`, … with no `at()`, day or month constraint) is aligned to wall-clock boundaries in the job's timezone and advances from the scheduled tick, so every server claims the same tick and the job runs once per tick.

### Changed

- The scheduler tick no longer waits for jobs to finish, so `scheduler:tick` fires on time while jobs run. By default jobs still run one at a time, in the same order as before: jobs that come due while one runs wait for it, then run in registration order. With `runInParallel(true, n)` each due job starts on its own tick, at most `n` (default `10`) at once, so one long job no longer holds back the others; parallel mode used to wait for each batch. A job never overlaps itself: a tick that finds it still running emits `job:skip`. `shutdown()` waits for every run the scheduler started.

## 5.39.1 - 2026-10-26

### Fixed

- A started scheduler is now listed in a process-wide registry until it stops, so the host (`@warlock.js/core`) can stop it on shutdown. Previously an application that never called `shutdown()` kept the process alive through the scheduler's tick timer.
- `shutdown()` no longer leaves its timeout timer armed when the running jobs finish first.

## 5.34.3 - 2026-10-20

### Changed

- Condensed the package agent skill description to at most 450 characters, with API names and package routing guidance.

## 5.34.2 - 2026-10-19

### Fixed

- Merge package orientation into the grouped skill index and remove the duplicate overview topic; preserve that orientation in generated LLM projections.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.25.0 - 2026-09-28

### Changed

- `scheduler.start()` is now a no-op, logging `scheduler: not started (role: ...)`, on a process that doesn't serve the `worker` role (`WARLOCK_ROLES`) — so an app calling it in `main.ts` doesn't run its jobs on every `web`/`api` node. The "jobs registered but `start()` never called" development warning no longer fires on such a process. With no `--role` passed, every role is on and nothing changes.

## 5.23.0 - 2026-09-25

### Added

- `scheduler.around((job, run) => …)` wraps every job callback execution, each retry attempt included, so jobs can run inside a context such as `AsyncLocalStorage`. Multiple hooks compose with the first registered outermost; the call returns an unsubscribe function. A hook that never calls `run` skips the execution and emits `job:skip` (`JobResult.skipped` / `skipReason`); a hook that throws follows the normal retry/error path.

## 5.22.0 - 2026-09-25

### Fixed

- Cron and time parsing handle absent fields explicitly under strict TypeScript checks.

## 5.20.0 - 2026-09-24

### Added

- `job.onOneServer({ lockTtl?, key? })` — run each tick on exactly one server. Every server races for a create-only, TTL-bounded cache claim keyed `scheduler.<key ?? name>.<scheduledTickEpochMs>`. The claim is never released, so exactly one server runs each tick even if another server's timer fires late. Losers skip the tick and emit `job:skip`. Requires a shared cache driver (redis/pg) and a job name or `key`. `@warlock.js/cache` is an optional peer dependency. Default claim TTL is `min(interval, 1h)` with a 60s floor (1h for cron jobs).

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.2

- Documented: the README, CHANGELOG, and `overview` skill now describe the
  already-shipped `package.json` `"warlock": { "environment": "server" }`
  marker — `@warlock.js/scheduler`'s entire runtime surface is server-only.
  The marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Fixed

- Warn in development when jobs are registered but `start()` is never called — a one-shot deferred check logs `N job(s) registered but scheduler.start() was never called`, is suppressed once `start()` runs or in production (`NODE_ENV=production`), and is unref'd so it never holds the process open.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
