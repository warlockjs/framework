# Changelog — @warlock.js/queue

All notable changes to `@warlock.js/queue` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.26.1 - 2026-09-30

### Fixed

- Republish of 5.26.0 with no code changes. npm accepted `@warlock.js/ai@5.26.0` but held it in a staged state that never became visible (npm/cli#9889), so 5.26.0 cannot be installed together with the AI packages. Use 5.26.1; 5.26.0 is deprecated.

## 5.26.0 - 2026-09-30

### Changed

- Dependencies: `fastify` ^5.12.5 (security fixes). `@bull-board/*` ^9.10.2.

## 5.25.0 - 2026-09-28

### Changed

- `startWorkers()` (and the `queueConnector`'s `start()`, which calls it) no longer starts in-process workers on a process that doesn't serve the `worker` role (`WARLOCK_ROLES`), logging `queue: workers not started (role: ...)` instead. Producers (`dispatch`) and the dashboard mount are unaffected. With no `--role` passed, every role is on and nothing changes.

## 5.24.0 - 2026-09-27

### Changed

- Lockstep release; package APIs are unchanged.

## 5.23.2 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.1 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.0 - 2026-09-25

### Added

- `defineQueueContext()` / `setQueueContext()`: capture ambient state (tenant, request id) at `dispatch` and restore it around the job handler. The captured value travels in a versioned envelope; jobs without one still run. Exposed as `ctx.context`. Opt a job out with `context: false`.
- `UnrecoverableJobError`: throw it from a handler or `restore` to fail the job permanently (mapped to BullMQ's `UnrecoverableError`).

## 5.22.1 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.

## 5.21.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.
## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.16.0 - 2026-09-18

### Fixed

- The failed-jobs dashboard skill sample now includes the connection config and the `authMiddleware` import.

## 5.15.0 - 2026-09-18

### BREAKING

- Removed `@warlock.js/queue/notifications` (`queueNotificationDispatcher`), deprecated in 5.14. Use `bullmqQueue()` from `@warlock.js/notifications` instead. The `@warlock.js/notifications` peer dependency is also dropped, since this was the only thing in the package that needed it.

### Fixed

- The dashboard guard now ends the request explicitly when a middleware short-circuits, instead of leaving it to Fastify noticing the reply was already sent. The adapter has always returned a "handled" boolean for this; the hook discarded it, so whether an unauthenticated caller reached the dashboard depended on write ordering — a guard answering asynchronously could lose that race.

## 5.14.0 - 2026-09-17

### Added

- `dashboard: { enabled, path, middleware }` in `src/config/queue.ts`: the queue connector mounts Bull Board at boot, guarded by the given middleware.
- `QueueDashboardUnguardedError`: in production the dashboard refuses to mount without guard middleware, since it can retry and delete jobs.
- `queueDashboard()` accepts a `middleware` option.

### Deprecated

- `@warlock.js/queue/notifications` (`queueNotificationDispatcher`): use `bullmqQueue()` from `@warlock.js/notifications`. It still works in 5.14, warns once, and is removed in the next release.

### Fixed

- The connector registers the queue config when it mounts the dashboard at boot, so an app whose only queue usage is the dashboard no longer fails to start with `QueueNotConfiguredError`.
- `find(id)` no longer returns a completed job with `result: null` and `attemptsMade: 0` when the job finishes mid-read.

## 5.13.0 - 2026-09-17

### Added

- New package: durable background jobs on BullMQ + Redis. Redis is required.
- `defineJob({ name, queue, attempts, backoff, removeOnComplete, removeOnFail, handle(payload, ctx) })` returns a typed job with `dispatch(payload, { delay, priority, jobId, attempts, backoff })` and `find(id)`.
- Job context: `id`, `name`, `queue`, `attempt`, `maxAttempts`, `progress(value)`, `log(line)`.
- `failedJobs({ queue, start, end })` and `retryFailedJob(id, { queue })`.
- `queueConnector()` for `warlock.config.ts > connectors`: reads the `queue` config key, starts workers in the app process (turn off with `workers.enabled: false`), and on shutdown waits for active jobs up to `workers.shutdownTimeout` before closing.
- `setQueueConfig`, `startWorkers`, `closeQueue` for scripts, tests and worker-only processes.
- `@warlock.js/queue/notifications`: `queueNotificationDispatcher()` sends `@warlock.js/notifications` `.queue()` deliveries through BullMQ, with retries and `delay` support.
- `queueDashboard(server, { basePath })`: mounts bull-board on Warlock's Fastify server. `@bull-board/api` and `@bull-board/fastify` are optional peers, loaded only when it is called; a missing one throws `QueueDashboardDependencyError`.

### Fixed

- Portable `typecheck` script: runs against this package's own `typescript` devDependency instead of relying on a hoisted binary from elsewhere in the workspace.
