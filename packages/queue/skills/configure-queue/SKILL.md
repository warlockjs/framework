---
name: configure-queue
description: 'Configure `@warlock.js/queue`: the declarative `src/config/queue.ts` (`QueueConfig` — `connection`, `prefix`, `defaultQueue`, `defaultJobOptions`, `workers: { enabled, concurrency, shutdownTimeout }`), registering `queueConnector()` in `warlock.config.ts > connectors`, running a dispatch-only process, and graceful shutdown. Programmatic `setQueueConfig` / `startWorkers` / `closeQueue` for scripts and tests. Triggers: `QueueConfig`, `queueConnector`, `setQueueConfig`, `startWorkers`, `closeQueue`, `workers.enabled`, `shutdownTimeout`; "configure the queue", "connect BullMQ to Redis", "disable workers in the web process", "graceful shutdown of jobs". Skip: writing jobs — `@warlock.js/queue/define-jobs/SKILL.md`.'
---

# Configure the queue

Redis is required. The config is declarative; the connector applies it.

```ts title="src/config/queue.ts"
import type { QueueConfig } from "@warlock.js/queue";

const queueConfig: QueueConfig = {
  connection: { host: "127.0.0.1", port: 6379 }, // any BullMQ connection option, or { url }
  prefix: "my-app", // Redis key prefix, default "warlock"
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  workers: {
    enabled: true, // default true
    concurrency: 5, // jobs in parallel per queue, default 1
    shutdownTimeout: 30_000, // ms to wait for active jobs, default 30000
  },
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

## What the connector does

- Starts in the **late** phase — after app code is imported — so every `defineJob` has registered. One worker per queue that has a job.
- No `queue` config → logs a warning and does nothing.
- On SIGINT/SIGTERM: workers stop taking jobs, active jobs get up to `shutdownTimeout` ms, then Redis connections close. A job still running after that is retried by another worker once its lock expires.

## Dispatch-only process

Set `workers.enabled: false`. `dispatch()` still works; nothing is processed in that process. Run the workers elsewhere with the same job definitions:

```ts
import { setQueueConfig, startWorkers, closeQueue } from "@warlock.js/queue";
import "./jobs"; // modules that call defineJob

setQueueConfig({ connection: { host: "127.0.0.1", port: 6379 } });
await startWorkers();
process.on("SIGTERM", () => closeQueue());
```

Every process must use the same `prefix`, or they will not see each other's jobs.
