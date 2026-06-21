---
title: "Recipe — Workflow with retry + cancellation"
description: A workflow whose flaky step retries with exponential backoff and whose long run can be cancelled from the outside via an AbortSignal — including the onCancel cleanup hook for releasing in-flight resources.
---

A document-processing workflow calls a third-party OCR service that is occasionally flaky, then runs an LLM extraction pass. Two real-world requirements show up immediately: the flaky network step should **retry with backoff** instead of failing the whole run on the first blip, and a user who closes the tab (or a request that exceeds its deadline) should be able to **cancel** the run mid-flight — releasing any reservation the in-flight step is holding.

`ai.workflow` gives you both as first-class config: a per-step `retry` block (attempts + backoff + an optional `retryOn` predicate), and an `AbortSignal` passed to `execute` that aborts the run at the next step boundary, firing each in-flight step's `onCancel` cleanup hook.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/seal
```

## Retry: bounded backoff on the flaky step

The `ocr` step retries up to 4 times with exponential backoff (500ms, 1s, 2s, …, capped at 30s). The `retryOn` predicate keeps retries narrow — only transient network failures are retried; a 4xx-style permanent error fails immediately instead of burning all four attempts.

```ts
import { ai } from "@warlock.js/ai";
import { ocrService, extractor, reservations } from "./pipeline";

type DocInput = { documentId: string; fileUrl: string };

const processDoc = ai.workflow<DocInput>({
  name: "doc-processing",
  steps: [
    ai.step({
      name: "ocr",
      retry: {
        attempts: 4,
        backoff: "exponential",
        // Only retry transient failures; bail fast on permanent ones.
        retryOn: error => isTransient(error),
        onRetry: (attempt, error) => {
          console.warn(`ocr retry #${attempt} after`, (error as Error).message);
        },
      },
      run: async ctx => {
        const text = await ocrService.read(ctx.input.fileUrl);
        ctx.state.text = text;
      },
    }),

    ai.step({
      name: "extract",
      agent: extractor,
      input: ctx => ({ prompt: `Extract structured fields from:\n\n${ctx.state.text}` }),
      output: { extract: ctx => ctx.agentResult?.data },
      after: ctx => {
        ctx.state.fields = ctx.steps.extract?.output;
      },
    }),
  ],
});

function isTransient(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN";
}
```

The retry loop wraps `before → run | agent → output → after`. Each attempt is recorded: `report.steps.ocr.attempts` and `report.steps.ocr.attemptHistory[]` show exactly how many tries it took and the status of each.

You can also set a workflow-wide `defaultRetry` that every step inherits unless it provides its own `retry` (or `retry: false` to opt out). Resolution precedence is `step.retry` → `defaultRetry` → `{ attempts: 1 }` (no retry).

## Cancellation: abort from the outside

Pass an `AbortSignal` to `execute`. Aborting it terminates the run at the next step boundary with `report.status === "cancelled"` and `result.error` set to a `WorkflowCancelledError`. The signal also threads into agent steps, so an in-flight model call is asked to stop (best-effort, provider-dependent).

The `onCancel` hook on a step lets you release whatever that step reserved. Here `ocr` takes a processing slot up front and frees it on cancel:

```ts
const processDocWithCleanup = ai.workflow<DocInput>({
  name: "doc-processing-cancellable",
  steps: [
    ai.step({
      name: "ocr",
      retry: { attempts: 4, backoff: "exponential", retryOn: isTransient },
      before: async ctx => {
        // Reserve an external processing slot before doing the work.
        ctx.state.reservationId = await reservations.acquire(ctx.input.documentId);
      },
      run: async ctx => {
        ctx.state.text = await ocrService.read(ctx.input.fileUrl);
      },
      after: async ctx => {
        // Happy path: release the slot once OCR succeeds.
        await reservations.release(ctx.state.reservationId as string);
      },
      onCancel: async ctx => {
        // Best-effort cleanup when the run is aborted mid-step. Errors here
        // are swallowed + logged — never rethrown.
        if (ctx.state.reservationId) {
          await reservations.release(ctx.state.reservationId as string);
        }
      },
    }),
    ai.step({
      name: "extract",
      agent: extractor,
      input: ctx => ({ prompt: `Extract fields from:\n\n${ctx.state.text}` }),
    }),
  ],
});
```

## Run it with a deadline

A common pattern: cancel automatically if the run exceeds a wall-clock budget, and also expose the controller so a UI "Cancel" button can abort it.

```ts
import { WorkflowCancelledError } from "@warlock.js/ai";

const controller = new AbortController();

// Hard deadline: abort after 30s.
const deadline = setTimeout(() => controller.abort("deadline exceeded"), 30_000);

// ...wire `controller.abort("user cancelled")` to your UI's cancel button.

try {
  const { data, error, report } = await processDocWithCleanup.execute(
    { documentId: "doc-918", fileUrl: "https://files.example.com/doc-918.pdf" },
    { signal: controller.signal },
  );

  if (error instanceof WorkflowCancelledError) {
    // Cancelled — `report.cancelledAt` is set; error.reason carries the
    // abort reason ("deadline exceeded" / "user cancelled").
    console.warn(`cancelled at ${report.cancelledAt}: ${error.reason}`);
  } else if (error) {
    // Genuine failure after retries were exhausted.
    console.error(`failed at status=${report.status}:`, error.message);
    console.error(`ocr took ${report.steps.ocr?.attempts} attempts`);
  } else {
    console.log("extracted fields:", data);
  }
} finally {
  clearTimeout(deadline);
}
```

What you observe on cancellation:

- `report.status` is `"cancelled"` and `report.cancelledAt` is an ISO timestamp.
- `result.error` is a `WorkflowCancelledError`; `error.reason` is whatever you passed to `abort(...)` (a string, an `Error`'s message, or a stringified value).
- Steps after the abort point never run — they're absent from `report.steps`.
- The in-flight step's `onCancel` fired best-effort, so the reservation was released.

## Production notes

- **Keep `retryOn` narrow.** Retrying a permanent error (bad input, auth failure) just delays the inevitable while burning attempts and backoff time. Match on transient signals — timeouts, connection resets, 429/503 — and let everything else fail fast.
- **Backoff is capped at 30s per attempt.** `"exponential"` is 500ms → 1s → 2s → 4s …; `"linear"` is `attempt × 500ms`; `"none"` retries immediately; or pass a custom `(attempt) => ms` function. All strategies are clamped to the 30s ceiling and floored at 0.
- **`retry` wraps `before → run|agent → output → after` — make every phase in that block idempotent.** A throw in `after` re-runs `before` and `run` on the next attempt. The slot reservation above is acquired in `before` and released in `after`, so a retried attempt re-acquires cleanly.
- **Cancellation is checked at step boundaries; mid-step abort is best-effort.** A synchronous `run` body that's already executing finishes before the between-step check aborts the workflow. For agent steps the signal is forwarded to the provider, but whether the HTTP call actually stops depends on the adapter.
- **`onCancel` errors are swallowed and logged, never rethrown.** Treat it as best-effort cleanup, not a place for logic that must succeed. If releasing a resource is critical, also reconcile it out-of-band (a sweeper that releases stale reservations).
- **A step whose retries are *exhausted* goes through `onFailure` (if defined) or halts the workflow — it does not hit `onCancel`.** `onCancel` is strictly for external abort; `onFailure` is for retry exhaustion. Don't conflate the two.
