---
name: local-queues
description: 'Run @warlock.js/queue without Redis: driver: "local" for durable single-host SQLite jobs using node:sqlite on Node >= 22.15, or driver: "memory" for real handler execution in tests. Covers local.path, leases, crash recovery, polling, concurrency, cancellation, graceful shutdown, and at-least-once delivery. Use for local/desktop background jobs, testing workers without Redis, or configuring SQLite queues.'
---

# Local and memory queues

Select a backend in the usual queue config; register `queueConnector()` as usual.
No extra dependency is needed. Existing config defaults to BullMQ.

```ts title="src/config/queue.ts"
import type { QueueConfig } from "@warlock.js/queue";

export default {
  driver: "local",
  prefix: "my-app",
  local: {
    path: "/var/lib/my-app/jobs.sqlite",
    leaseDuration: 30_000,
    pollInterval: 100,
  },
  workers: { concurrency: 3, shutdownTimeout: 5000 },
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
} satisfies QueueConfig;
```

Node's built-in SQLite is available without flags from Node 22.13, still
experimental in Node 22.15. A no-flags import/query was verified on Node
22.15.0. Require Node >= 22.15 with `node:sqlite` available; unavailable
runtimes throw on selecting local storage. Sources:
[Node changelog](https://nodejs.org/en/blog/release/v22.13.0),
[Node 22.15 API](https://nodejs.org/download/release/v22.15.0/docs/api/sqlite.html).
BullMQ/memory do not load SQLite.

## Define, dispatch, inspect, and retry

```ts
import { defineJob, failedJobs, retryFailedJob } from "@warlock.js/queue";

const resize = defineJob({
  name: "images.resize",
  async handle(payload: { imageId: string }, ctx) {
    ctx.signal?.throwIfAborted();
    await ctx.progress(50);
    await ctx.log(`resizing ${payload.imageId}`);
    return { ready: true };
  },
});

const { id } = await resize.dispatch(
  { imageId: "42" },
  {
    jobId: "resize-42",
    delay: "2s",
    priority: 1,
    attempts: 4,
    backoff: { type: "fixed", delay: 500 },
  },
);
const snapshot = await resize.find(id);
console.log(snapshot?.state, snapshot?.result);
for (const job of await failedJobs()) await job.retry();
// For an id known to be failed: await retryFailedJob(id);
```

The same API supports fixed/numeric or exponential backoff, priority/FIFO,
retention, context propagation, `UnrecoverableJobError`, and failed-job retry.
Payload/context/result/progress are JSON data. Attempts include the first
execution; crashed leases re-deliver without consuming a settled attempt.

## Memory tests and scripts

```ts
import {
  closeQueue,
  defineJob,
  setDispatchInterceptor,
  setQueueConfig,
  startWorkers,
} from "@warlock.js/queue";

setDispatchInterceptor(undefined); // opt out of queueFake for real execution
setQueueConfig({ driver: "memory", workers: { concurrency: 2 } });
const double = defineJob({ name: "numbers.double", handle: (value: number) => value * 2 });
await startWorkers();
const { id } = await double.dispatch(21);
try {
  const deadline = Date.now() + 5000;
  while ((await double.find(id))?.state !== "completed") {
    if (Date.now() >= deadline) throw new Error("Job did not complete");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  console.log((await double.find(id))?.result); // 42
} finally {
  await closeQueue({ timeout: 1000 });
}
```

Memory storage belongs to one process and is cleared by `closeQueue()`.
Use temporary SQLite files for restart/crash tests. `workers.enabled: false`
and process-role gating work for every backend.

## Durability and shutdown rules

- Use the same absolute file path, namespace (`prefix`), and job definitions
  in every producer/worker. Default file: `.warlock/queue.sqlite`, relative
  to cwd. Parents are created; use writable local disk, never a network share.
- SQLite WAL plus FULL synchronous writes persist jobs. Short synchronous
  transactions claim jobs atomically. A unique token fences every renewal,
  progress update, and completion; an expired owner cannot write.
- The lease defaults to 30 seconds, renews every third of its duration, and
  must be at least 30 ms. Polling defaults to 100 ms, minimum 1 ms. Concurrency
  is per queue per process. Avoid blocking the event loop longer than the lease.
- Shutdown stops claims immediately, finishes handlers within the timeout,
  then aborts `ctx.signal` and releases remaining leases. Observe cancellation
  in handlers and operations. Await close before changing config or restarting.
- A crashed process's jobs re-deliver after lease expiry. Delivery is at least
  once: make external side effects idempotent. Expired/released handlers that
  ignore cancellation can keep running even though queue writes are fenced.
- `getQueue()` and bull-board require BullMQ. Use `find()` / `failedJobs()`
  with local/memory queues. Prefer BullMQ for multi-host/high-volume workloads.
