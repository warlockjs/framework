---
name: overview
description: 'Front door for `@warlock.js/queue` — durable background jobs for Warlock apps on BullMQ + Redis (Redis is required): `defineJob` + `.dispatch()`, retries/backoff, delay, priority, progress, failed-job listing/retry, in-process workers started by `queueConnector()` with graceful shutdown, a BullMQ backend for notifications `.queue()`, and an optional bull-board dashboard. TRIGGER when: importing from `@warlock.js/queue`; "background job", "job queue", "run this later", "retry failed jobs", "BullMQ in Warlock", "worker process". Skip: in-memory batching inside one process — that is core''s `Queue` class (`@warlock.js/core`); cron-style schedules — `@warlock.js/scheduler/overview/SKILL.md`; a known task — load `configure-queue`, `define-jobs`, `manage-failed-jobs` or `queue-notifications`.'
---

# `@warlock.js/queue` — overview

Durable background jobs. Jobs are stored in **Redis** (required), retried on failure, and processed by workers — inside the app process by default.

## Mental model

- **Job definition** — `defineJob({ name, handle })` registers a handler by name and returns a typed job.
- **Dispatch** — `job.dispatch(payload, options)` stores the job in Redis. Any process with the same definition and a worker can run it.
- **Worker** — one per queue name, started by `queueConnector()` (or `startWorkers()`); routes each job to the handler with its name.
- **Shutdown** — workers stop taking jobs, active jobs finish (up to `workers.shutdownTimeout`), then connections close.

## Not core's `Queue`

`@warlock.js/core` exports `Queue` — an in-memory batcher that flushes items by size or interval inside one process. No storage, no retries, lost on exit. Use `@warlock.js/queue` when work must survive a restart or be retried.

## Skills index

- [`configure-queue`](@warlock.js/queue/configure-queue/SKILL.md) — `src/config/queue.ts`, `queueConnector()`, workers on/off, shutdown.
- [`define-jobs`](@warlock.js/queue/define-jobs/SKILL.md) — `defineJob`, `dispatch` options, retries, progress, `find`.
- [`manage-failed-jobs`](@warlock.js/queue/manage-failed-jobs/SKILL.md) — `failedJobs`, `retryFailedJob`, the bull-board dashboard.
- [`queue-notifications`](@warlock.js/queue/queue-notifications/SKILL.md) — `queueNotificationDispatcher()` for notifications `.queue()`.
