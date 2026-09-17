# Changelog — @warlock.js/queue

All notable changes to `@warlock.js/queue` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## Unreleased

### Fixed

- `find(id)` could return an inconsistent snapshot when a job finished between the internal state read and the job data read — e.g. `state: "completed"` alongside a `null` `result`, `attemptsMade: 0`, and no `finishedAt`. The job's state is now read first, then the job is re-fetched, so the returned fields are consistent with the reported state.

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
