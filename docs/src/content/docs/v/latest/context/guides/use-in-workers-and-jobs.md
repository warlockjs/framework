---
title: "Use in workers and jobs"
description: Set up a fresh context on worker threads, queue consumers, scheduled jobs, and child processes — every boundary needs its own run().
sidebar:
  order: 3
  label: "Use in workers and jobs"
---

Context propagates through `await`. It does **not** propagate across process or worker boundaries. Anywhere the work jumps to a fresh task — a worker thread, a queue consumer, a scheduled job, a child process — you set the context again at the new boundary.

The rule is simple: a process boundary is a wall. Past the wall, you start a new `run()`.

## The boundaries that need a fresh `run()`

- **Worker threads** (`node:worker_threads`) — the worker boots with no parent context.
- **Child processes** (`node:child_process`, forked services) — fully separate process, separate event loop.
- **Queue consumers** (RabbitMQ, BullMQ, SQS, Redis streams) — the consumer worker started days ago; the producer's context died long before the message was picked up.
- **Scheduled jobs** (`@warlock.js/scheduler`, cron, agenda) — no incoming request, no producer; the scheduler tick is the boundary.
- **HTTP fan-out** — if you call another service over HTTP, that service runs in its own process. Propagate context across the wire as headers if you need it.

## Pattern: queue consumer

```ts
import { contextManager } from "@warlock.js/context";
import "./contexts"; // ensures registration

async function startConsumer(queue: Queue) {
  for await (const message of queue.consume()) {
    const stores = contextManager.buildStores({
      user: message.user,
      tenantId: message.tenantId,
      source: "queue",
    });

    await contextManager.runAll(stores, async () => {
      await processMessage(message);
    });
  }
}
```

One `runAll` per message. The store dies when `processMessage` resolves; the next iteration of the loop gets a fresh one. The consumer worker process itself is long-lived — only the per-message scope is short.

Trace ids deserve a special note here. If your producer wrote `traceId` into the message payload, your consumer's `TraceContext.buildStore` should read it instead of generating a new one — that is how a trace stays linked across the queue:

```ts
class TraceContext extends Context<{ traceId: string }> {
  public buildStore(payload?: Record<string, any>): { traceId: string } {
    return { traceId: payload?.traceId ?? randomUUID() };
  }
}
```

Producer-side, write `traceContext.get("traceId")` into the message. Consumer-side, pass `traceId: message.traceId` to `buildStores`. Same trace, two processes.

## Pattern: scheduled job

```ts
import { contextManager } from "@warlock.js/context";
import { randomUUID } from "crypto";

async function runDailyCleanup() {
  const stores = contextManager.buildStores({
    traceId: randomUUID(),
    source: "cron:daily-cleanup",
  });

  await contextManager.runAll(stores, async () => {
    await cleanupExpiredSessions();
    await pruneOldAuditLogs();
  });
}
```

No incoming request means no propagated trace — generate one. The `source` field is convention, not API; pick a string scheme that makes the job traceable in your logs.

## Pattern: worker thread

The worker file has its own module graph, its own globals, and — critically — its own `AsyncLocalStorage` instances. Even if you import the same `userContext` file in main and worker, the running storage is separate per process. Set the context inside the worker:

```ts title="src/workers/heavy-task.worker.ts"
import { parentPort, workerData } from "node:worker_threads";
import { userContext } from "../contexts/user-context";

async function main() {
  await userContext.run(
    { userId: workerData.userId, role: workerData.role },
    async () => {
      const result = await doHeavyWork(workerData.input);
      parentPort?.postMessage(result);
    },
  );
}

main();
```

```ts title="src/services/heavy-task.service.ts"
import { Worker } from "node:worker_threads";
import { userContext } from "../contexts/user-context";

export async function spawnHeavyTask(input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/heavy-task.worker.js", import.meta.url), {
      workerData: {
        input,
        userId: userContext.get("userId"),
        role: userContext.get("role"),
      },
    });

    worker.once("message", resolve);
    worker.once("error", reject);
  });
}
```

The main thread reads the context, copies the values into `workerData`, and ships them across the boundary. The worker reconstructs the context from `workerData` before doing any work that expects it.

## Pattern: HTTP fan-out (cross-service)

Calling another service over HTTP is a process boundary even though it does not look like one. Propagate via headers:

```ts
// In the calling service
import { traceContext } from "../contexts/trace-context";

const response = await fetch(otherService.url, {
  headers: {
    "x-trace-id": traceContext.get("traceId") ?? randomUUID(),
    "x-user-id": userContext.get("userId") ?? "",
  },
});
```

```ts
// In the receiving service's request middleware
import { contextManager } from "@warlock.js/context";

app.use(async (req, res, next) => {
  const stores = contextManager.buildStores({
    traceId: req.headers["x-trace-id"],
    userId: req.headers["x-user-id"],
  });

  await contextManager.runAll(stores, async () => {
    next();
  });
});
```

Same idea as the queue case — the producer side writes; the consumer side reads and re-runs.

## What you cannot do

A few things that look reasonable but do not work:

- **`AsyncLocalStorage.snapshot()` across processes.** Snapshots are in-process references. They do not serialize. Cross a process, you serialize the values (the `userId` string, not the storage handle).
- **Inheriting context into a freshly spawned Promise pool that runs after the scope ended.** If `run()` resolves and a Promise scheduled inside it has not started yet, that Promise still has the context — but if you fan work out to a long-lived pool that processes tasks in its own loop, the pool itself runs outside your scope. Set context inside the worker function the pool calls.
- **Sharing context between a parent and a `cluster.fork()` worker.** Same as worker threads — separate processes, separate storage. Pass values explicitly.

## Things to avoid

- **Don't assume "I imported the same context file" means the store survives.** Modules are imported per process; storage is per process. Fresh process, fresh store.
- **Don't rely on `enterAll` across yields where you do not control the surrounding scope.** Workers, schedulers, and queues each have their own task lifetime — `runAll` is the right tool because the scope is bounded.
- **Don't reach for `userContext.set` from a worker assuming the main thread will see it.** Stores are not shared memory; they are per-call-tree state.

## Related

- [The context model](../essentials/01-the-context-model) — what propagates, what does not.
- [Orchestrate contexts](./orchestrate-contexts) — registering and running multiple contexts.
- [API reference](../reference/api) — full method signatures.
