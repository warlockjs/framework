---
description: 'Background jobs on BullMQ + Redis, local SQLite, or memory: retries, delays, priorities, workers, failed-job recovery. Exports `defineJob`, `queueConnector`, `startWorkers`, `closeQueue`, `getQueue`, `failedJobs`, `retryFailedJob`, `mountQueueDashboard`, `QueueConfig`, `QueueJob`. Use for: "run this in the background", "retry a failed job", "delay a job", "survive restarts", "job dashboard". Not this package: cron or recurring schedules → @warlock.js/scheduler; broker pub/sub messaging → @warlock.js/herald; core `Queue` is an in-memory batcher.'
---

# @warlock.js/queue

Jobs are stored in Redis (default; not bundled), local SQLite without Redis, or memory for tests, retried on failure, and run by workers, in the app process by default. `defineJob({ name, handle })` registers a handler and returns a typed job; `job.dispatch(payload, options)` enqueues it. Any process with the same definition and a worker can run it. Server-only.

## The 80% path

1. Use this index for orientation and choose a task below.
2. Configure `src/config/queue.ts` and register `queueConnector()`: `configure-queue.md`.
3. Define and dispatch jobs (attempts, backoff, delay, priority, progress): `define-jobs.md`.
4. Inspect and recover failures, optionally the bull-board dashboard: `manage-failed-jobs.md`.
5. Back `@warlock.js/notifications` `.queue()` with BullMQ: `queue-notifications.md`.

## Conventions and pitfalls

- Job names are the routing key; a job with no matching `defineJob` in the worker process cannot run.
- Handlers must be idempotent: retries re-run them.
- Shutdown lets active jobs finish up to `workers.shutdownTimeout`, then closes connections.
- Guard the dashboard with middleware; an unguarded one is refused on purpose.
- Core `Queue` is an in-memory batcher, lost on exit; use this package when work must survive.
- Do not value-import from client code.

Use the `local-queues` topic for `driver: "local"` / `"memory"`, Node requirements, leases, crash recovery, and cancellation.

## Mental model

- **Job definition** — `defineJob({ name, handle })` registers a handler by name and returns a typed job.
- **Dispatch** — `job.dispatch(payload, options)` stores the job in the configured backend. Any process with the same definition and a worker can run it.
- **Worker** — one per queue name, started by `queueConnector()` (or `startWorkers()`); routes each job to the handler with its name.
- **Shutdown** — workers stop taking jobs, active jobs finish (up to `workers.shutdownTimeout`), then connections close.

## Not core's `Queue`

`@warlock.js/core` exports `Queue` — an in-memory batcher that flushes items by size or interval inside one process. No storage, no retries, lost on exit. Use `@warlock.js/queue` when work must survive a restart or be retried.
