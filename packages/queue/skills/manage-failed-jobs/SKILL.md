---
name: manage-failed-jobs
description: "Failed jobs in @warlock.js/queue; use when you need to manage failed jobs."
---

# Failed jobs

A job is failed once it has used every attempt, or failed in a way that cannot be retried (for example, no handler for its name). Failed jobs are kept unless you set `removeOnFail`.

```ts
import { failedJobs, retryFailedJob } from "@warlock.js/queue";

const failed = await failedJobs({ queue: "default", start: 0, end: 49 }); // newest first

for (const job of failed) {
  console.log(job.name, job.failedReason, job.attemptsMade);
}

await failed[0]?.retry(); // back to waiting
await retryFailedJob("invoice:43"); // by id; throws FailedJobNotFoundError if not failed
```

## Dashboard (optional)

```sh
warlock add bull-board
```

This installs `@bull-board/api` + `@bull-board/fastify` and writes a `dashboard` block to `src/config/queue.ts`. It `requires: ["queue"]`, so it adds the `queue` feature first automatically when it isn't installed yet — no need to run `warlock add queue` yourself first:

```ts title="src/config/queue.ts"
import type { QueueConfig } from "@warlock.js/queue";
import { middleware } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";

const queueConfig: QueueConfig = {
  connection: { host: "127.0.0.1", port: 6379 },
  dashboard: {
    enabled: true,
    path: "/admin/queues", // default
    middleware: [authMiddleware("admin")], // guards every dashboard route
  },
};

export default queueConfig;
```

- The dashboard can retry and delete jobs, so it must be guarded. In production, an empty `middleware` list throws `QueueDashboardUnguardedError` at boot instead of mounting exposed. Outside production it logs a warning and mounts anyway.
- `queueConnector()` mounts the dashboard at boot from this config — no extra wiring needed.

### Advanced: manual `queueDashboard()`

For mounting outside the config-driven path (a custom server, a non-standard boot sequence), call `queueDashboard` yourself:

```ts
import { getHttpServer } from "@warlock.js/core";
import { queueDashboard } from "@warlock.js/queue";
import { authMiddleware } from "@warlock.js/auth";

await queueDashboard(getHttpServer(), {
  basePath: "/admin/queues",
  middleware: [authMiddleware("admin")],
});
```

- Call it before the HTTP server starts listening.
- Shows every queue that has a job, plus the default queue, unless you pass `queues`.
- It has no authentication of its own — pass `middleware` yourself; this path does not enforce the production guard that the `dashboard` config does.
