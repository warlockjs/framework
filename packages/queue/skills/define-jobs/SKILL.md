---
name: define-jobs
description: 'Define and dispatch background jobs with `@warlock.js/queue`: `defineJob({ name, queue?, attempts?, backoff?, removeOnComplete?, removeOnFail?, handle(payload, ctx) })` returns a typed job; `job.dispatch(payload, { delay, priority, jobId, attempts, backoff })`; the handler context (`id`, `attempt`, `maxAttempts`, `progress()`, `log()`); reading a job with `job.find(id)`. Triggers: `defineJob`, `.dispatch(`, `ctx.progress`, `JobContext`, `DispatchOptions`, `backoff`, `attempts`, `priority`, `jobId`; "run this in the background", "retry with backoff", "delay a job", "job progress", "idempotent dispatch". Skip: config and workers — `@warlock.js/queue/configure-queue/SKILL.md`; failed jobs — `@warlock.js/queue/manage-failed-jobs/SKILL.md`.'
---

# Define and dispatch jobs

```ts title="src/app/invoices/jobs/send-invoice.job.ts"
import { defineJob } from "@warlock.js/queue";

export const sendInvoice = defineJob({
  name: "invoices.send", // unique across the app
  attempts: 5, // total tries, default 1
  backoff: { type: "exponential", delay: 2000 }, // or a number = fixed ms
  async handle(payload: { invoiceId: string }, ctx) {
    await ctx.log(`attempt ${ctx.attempt} of ${ctx.maxAttempts}`);
    await ctx.progress(50);
    // throw to fail this attempt; it is retried until attempts run out
    return { sent: true }; // stored as the job result
  },
});
```

The job module must be imported by the process that runs workers — in a Warlock app, anything under `src/app` that is loaded at boot.

## Dispatch

```ts
const { id } = await sendInvoice.dispatch({ invoiceId: "42" });

await sendInvoice.dispatch({ invoiceId: "43" }, {
  delay: "10m", // ms number or "500ms" | "30s" | "10m" | "2h" | "1d"
  priority: 1, // 1 runs first; larger numbers later
  jobId: "invoice:43", // a second dispatch with a live id is ignored
});
```

Option precedence: dispatch options > `defineJob` > `queue.defaultJobOptions`.

## Read a job

```ts
const job = await sendInvoice.find(id);
// { id, name, queue, state, payload, progress, attemptsMade, result, failedReason, createdAt, finishedAt }
```

## Rules

- A job name with no handler in the worker process fails at once, without retries.
- Payloads are stored as JSON: pass ids, not model instances.
- Defining the same name again replaces the handler (this is what keeps dev reloads working), so keep names unique.
