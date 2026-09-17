# @warlock.js/queue

Durable background jobs for Warlock.js, built on [BullMQ](https://docs.bullmq.io).

- `defineJob({ name, handle, attempts, backoff })` → a typed job with `.dispatch(payload, { delay, priority, jobId })`
- Retries with fixed or exponential backoff, delays, priorities, progress
- Failed-job listing and retry (`failedJobs()`, `retryFailedJob()`)
- Workers run inside the app process by default and shut down gracefully (active jobs finish first, with a time limit)
- A BullMQ backend for `@warlock.js/notifications` `.queue()`
- An optional bull-board dashboard

## Requirements

**Redis is required.** BullMQ stores every job in Redis (5.0 or newer; any Redis-compatible server BullMQ supports, such as Valkey or Dragonfly, also works). This package does not start or bundle Redis.

## Not the same as core's `Queue`

`@warlock.js/core` exports a `Queue` class (`core/src/utils/queue.ts`). That one is an **in-memory batcher inside one process**: it collects items and flushes them when a size or time limit is reached. Nothing is stored; items are lost when the process exits; there are no retries.

`@warlock.js/queue` is for **durable jobs**: they are stored in Redis, survive restarts, retry on failure, and can be processed by another process.

## Install

```sh
npm install @warlock.js/queue
```

## Configure

```ts title="src/config/queue.ts"
import type { QueueConfig } from "@warlock.js/queue";

const queueConfig: QueueConfig = {
  connection: { host: "127.0.0.1", port: 6379 },
  prefix: "my-app",
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  workers: { enabled: true, concurrency: 5, shutdownTimeout: 30_000 },
};

export default queueConfig;
```

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";
import { queueConnector } from "@warlock.js/queue";

export default defineConfig({
  connectors: [queueConnector()],
});
```

The connector starts after your app code is loaded, so every `defineJob` is registered before workers start. On shutdown (SIGINT/SIGTERM) it stops the workers, waits up to `shutdownTimeout` ms for running jobs, then closes the Redis connections.

Set `workers.enabled: false` in a process that should only dispatch jobs.

## Define and dispatch

```ts
import { defineJob } from "@warlock.js/queue";

export const sendInvoice = defineJob({
  name: "invoices.send",
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  async handle(payload: { invoiceId: string }, ctx) {
    await ctx.progress(10);
    // ... work ...
    await ctx.progress(100);
    return { sent: true };
  },
});

await sendInvoice.dispatch({ invoiceId: "42" });
await sendInvoice.dispatch({ invoiceId: "43" }, { delay: "10m", priority: 1, jobId: "invoice:43" });

const snapshot = await sendInvoice.find("invoice:43"); // state, progress, result, failedReason
```

## Failed jobs

```ts
import { failedJobs, retryFailedJob } from "@warlock.js/queue";

for (const job of await failedJobs()) {
  console.log(job.name, job.failedReason, job.attemptsMade);
}

await retryFailedJob("invoice:43");
```

## Notifications

Vendor integrations live as lazy drivers inside the feature package now:
configure the BullMQ driver from `@warlock.js/notifications` itself.

```ts title="src/config/notifications.ts"
import { bullmqQueue } from "@warlock.js/notifications";

const config: NotificationConfig = {
  channels: { mail: mailChannel() },
  queue: bullmqQueue({ attempts: 3 }),
};
```

`.queue()` notifications now go through BullMQ. `SendOptions.delay` is honoured.
`@warlock.js/queue` is dynamically imported the first time `.queue()` runs —
notifications never pays for it unless `bullmqQueue()` is configured.


## Dashboard (optional)

```sh
warlock add bull-board
```

Installs `@bull-board/api` and `@bull-board/fastify` and adds a `dashboard` block to
`src/config/queue.ts`:

```ts
import { middleware } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";
import type { QueueConfig } from "@warlock.js/queue";

const queueConfig: QueueConfig = {
  // ...
  dashboard: {
    enabled: true,
    path: "/admin/queues",
    // Runs before every dashboard route — the dashboard can retry and delete
    // jobs, so guard it. An empty list here throws
    // QueueDashboardUnguardedError at boot when NODE_ENV is "production".
    middleware: [authMiddleware("admin")],
  },
};

export default queueConfig;
```

`queueConnector()` mounts the dashboard for you at boot, once the HTTP server exists.
Outside production an empty `middleware` list is allowed — it mounts anyway and logs one
warning, so local development stays frictionless.

> **Advanced — mounting manually:** `queueDashboard(server, { basePath, middleware, queues })`
> is still exported for scripts, worker-only processes, or a custom mount point. The
> bull-board packages are loaded only when it is called; a missing one throws
> `QueueDashboardDependencyError` with the install command.
>
> ```ts
> import { getHttpServer } from "@warlock.js/core";
> import { queueDashboard } from "@warlock.js/queue";
>
> await queueDashboard(getHttpServer(), { basePath: "/admin/queues", middleware: [authMiddleware("admin")] });
> ```

## License

MIT
