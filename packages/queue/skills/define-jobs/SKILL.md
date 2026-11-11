---
name: define-jobs
description: 'Define and dispatch background jobs with `@warlock.js/queue`: `defineJob({ name, queue?, attempts?, backoff?, timeout?, failOnTimeout?, removeOnComplete?, removeOnFail?, handle(payload, ctx) })` returns a typed job; `job.dispatch(payload, { delay, priority, jobId, attempts, backoff, timeout, failOnTimeout })`; the handler context (`id`, `attempt`, `maxAttempts`, `progress()`, `log()`); reading a job with `job.find(id)`. Triggers: `setDispatchInterceptor`, `queueFake`, `defineJob`, `.dispatch(`, `ctx.progress`, `JobContext`, `DispatchOptions`, `backoff`, `attempts`, `priority`, `jobId`; "run this in the background", "retry with backoff", "delay a job", "job progress", "idempotent dispatch". Skip: config and workers — the `configure-queue` topic; failed jobs — the `manage-failed-jobs` topic.'
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

await sendInvoice.dispatch(
  { invoiceId: "43" },
  {
    delay: "10m", // ms number or "500ms" | "30s" | "10m" | "2h" | "1d"
    priority: 1, // 1 runs first; larger numbers later
    jobId: "invoice:43", // a second dispatch with a live id is ignored
  },
);
```

## Timeouts

`timeout: "2m"` (ms or duration string, must be > 0) fails an attempt that runs too long with `JobTimeoutError`; `attempts`/`backoff` still apply. `failOnTimeout: true` fails the job without retrying. Works on all drivers; set in `defineJob`, dispatch options or `queue.defaultJobOptions`. `ctx.signal` aborts on timeout: pass it to `fetch`/db calls. A handler that ignores it keeps running in the background (JS cannot kill it).

Option precedence: dispatch options > `defineJob` > `queue.defaultJobOptions`.

## Retention

Finished jobs are pruned by default: `removeOnComplete: { age: "24h", count: 1000 }`, `removeOnFail: { age: "7d", count: 5000 }`. A retention is `true` (remove at once), `false` (keep all), a number (newest N), or `{ age?, count? }` (`age` is ms or a duration string). Set it in `defineJob` or `queue.defaultJobOptions`; `false` restores keep-everything.

## Read a job

```ts
const job = await sendInvoice.find(id);
// { id, name, queue, state, payload, progress, attemptsMade, result, failedReason, createdAt, finishedAt }
```

## List the defined jobs

`registeredJobs()` returns every definition `defineJob()` registered in this process, and `queueOf(definition)` the queue it runs on. Neither touches Redis; `warlock inspect --section jobs` prints the same list for a whole app.

```ts
import { queueOf, registeredJobs } from "@warlock.js/queue";

const jobs = registeredJobs().map((job) => ({ name: job.name, queue: queueOf(job) }));
```

## Carry request context into jobs

```ts
setQueueContext(
  defineQueueContext({
    capture: () => tenantStorage.getStore(), // runs inside dispatch()
    restore: (tenant, run) => tenantStorage.run(tenant, run), // wraps handle()
  }),
);
```

- `undefined` from `capture` carries nothing; the value must be JSON-safe. Read it in a handler as `ctx.context` (`unknown`).
- Jobs dispatched from a restored handler capture the same context.
- `defineJob({ context: false })` opts a job out; it never runs inside a restored context.
- Every dispatch is wrapped in an envelope, so a payload shaped like one (an untrusted request body) is plain data to the handler and never sets the context.
- Throw `UnrecoverableJobError` from a handler or `restore` to fail the job without retries.

## Test dispatches without Redis

In the test environment `queueFake` from `@warlock.js/core/tests` is installed by default: dispatches are recorded, not pushed, and `find()` answers from the record.

```ts
// with: import { queueFake } from "@warlock.js/core/tests";
//       plus your job (sendInvoice) and service (placeOrderService)
it("queues the invoice", async () => {
  const order = await placeOrderService({ items: ["pen"] });

  queueFake.assertPushed(sendInvoice, { invoiceId: order.invoiceId });
  expect(queueFake.pushed(sendInvoice)).toHaveLength(1);
});
```

Jobs are not run — call the handler to test it. Opt out with `tests.fakes: { queue: false }`. The seam is `setDispatchInterceptor({ dispatch, find? })`: while set, every job's `dispatch()` / `find()` goes to it instead of BullMQ; set it back to `undefined` to restore the broker.

## Rules

- A job name with no handler in the worker process fails at once, without retries.
- Payloads are stored as JSON: pass ids, not model instances.
- Defining the same name again replaces the handler (this is what keeps dev reloads working), so keep names unique.
