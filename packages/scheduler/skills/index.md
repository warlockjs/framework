---
description: 'In-process cron and fluent scheduling: `Scheduler`, `scheduler`, `Job`, `job`, `CronParser` and `parseCron`. Use for "run every day at 3am", "schedule weekdays", "retry a failing job", "prevent overlap", choose a timezone or observe job failures. Not this package → @warlock.js/queue for durable background workers; @warlock.js/cache for locks across instances; @warlock.js/herald for broker messaging.'
---

# @warlock.js/scheduler

Build a `job(name, fn)`, describe when it runs with the fluent API (`.daily().at("03:00")`) or `.cron("...")`, add it to a `Scheduler`, then `start()`. Events (`job:error` and others) provide observability; `shutdown()` stops gracefully.

## The 80% path

1. Start with `scheduler-basics.md`.
2. Define the schedule fluently: `schedule-fluently.md`, or by cron: `schedule-with-cron.md`.
3. Make it resilient: `configure-retry-and-overlap.md`.
4. Fix wall-clock semantics: `pin-schedule-timezone.md`.
5. Watch it run: `observe-scheduler.md`.

## Conventions and pitfalls

- It is in-memory and per-process: each app instance runs its own copy. With multiple instances, guard jobs with a lock (for example `@warlock.js/cache`) or run the scheduler in one instance only.
- Missed runs while the process was down are not replayed.
- Set a timezone explicitly for jobs tied to business hours; otherwise UTC applies.
- Call `scheduler.shutdown()` on SIGTERM so running jobs finish.
- Use `preventOverlap()` for jobs that can outlast their interval.

## Server-only package

`@warlock.js/scheduler`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. This is build-boundary metadata read by `@warlock.js/web`'s Gate A (import resolution) and Gate C (emitted-bundle verification), not application behavior. App code that reaches the client bundle (including page and layout modules) must not value-import `@warlock.js/scheduler` — Gate A refuses the build. A type-only import (`import type { ... }`) is allowed. Server loaders, controllers, and modules may import it freely.

## When to reach for it

- You have **recurring work** in a Node service (cleanups, reports, syncs, polling) and want it scheduled inside the app process — no external cron, no docker-cron sidecar.
- You'd reach for **node-cron** or **agenda** but want a typed fluent API, retry-with-backoff, overlap prevention, and a working observability story built in — without bringing Redis (agenda) or hand-rolling retry yourself (node-cron).
- You're inside a `@warlock.js/*` project — the framework already uses this for built-in maintenance jobs (token cleanup, etc.).

Skip if you need a **distributed** job queue with persistence, retries across processes, and worker pools — reach for **BullMQ** or **Temporal**. This package runs jobs **in-process**; if the process dies before the next tick, the schedule resumes from now, not from the missed fire time.

## The mental model in one paragraph

Define a job with `job("name", async () => { ... })`. Attach a schedule via the fluent API (`.daily().at("03:00")`) or a cron string (`.cron("0 3 * * *")`). Optionally pin a timezone (`.inTimezone("America/New_York")`), prevent concurrent runs (`.preventOverlap()`), and configure retries (`.retry(3, 1000)`). Register the job with `scheduler.addJob(job)`, call `scheduler.start()`, and listen on the seven lifecycle events (`job:start` / `complete` / `error` / `skip`, `scheduler:started` / `stopped` / `tick`) for logging, metrics, and alerting. `scheduler.shutdown()` drains in-flight jobs before exit.

## What this package deliberately doesn't do

- **Distributed scheduling across processes.** Jobs run in the calling process. For multi-instance deployments, either run the scheduler on one instance (with a leader election) or reach for BullMQ / Temporal.
- **Persistent job state across restarts.** A missed fire while the process was down is missed — it doesn't catch up. For exactly-once-eventually semantics, use a queue.
- **Job priority queues or fan-out.** One job = one function. For fan-out, your job dispatches to a queue.
- **Cron-syntax extensions** beyond the standard 5-field form (no `@daily` macros, no seconds field). Use the fluent API for human-readable schedules instead.

## See also

- The `warlock-js-core` skill index — the parent framework that scheduled jobs typically run alongside.
