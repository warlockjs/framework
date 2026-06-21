---
title: "Recipe — Wire Panoptic onto a run"
description: Attach the @warlock.js/ai-panoptic subscriber to an agent, retain every trace in the in-memory store, and query failed runs after the fact.
sidebar:
  order: 20
  label: "Observability — wire Panoptic"
---

You shipped a support agent last week. This morning a customer reports it "just hung" on a refund question, and your only signal is a 500 in the gateway log. You have no idea which trip failed, how many tokens it burned before dying, or whether it was the model or a tool. You need the run's execution tree — captured automatically, queryable after the fact, off the request's hot path.

That is exactly what `@warlock.js/ai-panoptic` does: one `panoptic({ exporters })` call wraps a collector, you `attach` it to the agent once, and every run — completed, failed, or cancelled — lands in a queryable store you can slice later.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-panoptic @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

`@warlock.js/ai-panoptic`'s only hard peer is `@warlock.js/ai` — the in-memory store and the console exporter pull in no extra SDK. (OpenTelemetry and Langfuse are optional peers; see the [export recipe](./observability-export-otel-langfuse).)

## The agent, plus one attach

The store satisfies both `TraceStoreContract` (queryable) and `ExporterContract` (a sink), so you register it like any other exporter and it fills as runs complete.

```ts
import { ai, ProviderRateLimitError } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import {
  panoptic,
  createInMemoryTraceStore,
  consoleExporter,
} from "@warlock.js/ai-panoptic";
import { v, type Infer } from "@warlock.js/seal";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const refundSchema = v.object({
  decision: v.enum(["approve", "deny", "escalate"]),
  reason: v.string(),
});

type RefundDecision = Infer<typeof refundSchema>;

const supportAgent = ai.agent({
  name: "refund-support",
  model: openai.model({ name: "gpt-4o-mini" }),
  output: refundSchema,
  systemPrompt: ai
    .systemPrompt()
    .persona("You are a refund-policy assistant.")
    .instruction("Approve only when the order is within the 30-day window."),
});

// Retain every trace in memory, and also echo a one-line summary to stdout.
const store = createInMemoryTraceStore({ capacity: 5_000 });

const observe = panoptic({
  exporters: [store, consoleExporter()],
});

// Subscribe once. `attach` wires the terminal *.completed events and
// returns a detach function. From here on, every run is captured.
const detach = observe.attach(supportAgent);
```

## Run it — capture happens automatically

`attach` subscribes to the agent's terminal `agent.completed` event, which fires once per run regardless of outcome (on failure the matching `agent.error` fires first, then `agent.completed` still fires). You write zero observability code in the hot path — you just run the agent.

```ts
async function handleRefundTurn(message: string, sessionId: string) {
  const { data, error } = await supportAgent.execute(message, { sessionId });

  if (error) {
    // The failed run is ALREADY in the store — Panoptic captured it on the
    // agent.error → agent.completed sequence before this branch ran.
    if (error instanceof ProviderRateLimitError) {
      return { retryAfterMs: error.retryAfter };
    }

    return { failed: true, code: error.code };
  }

  return data satisfies RefundDecision;
}

await handleRefundTurn("Refund order #8842, it arrived broken.", "session-42");
```

## Query the store after the fact

This is the part that answers the morning's question. The store retains every run; `query` returns matching traces newest-started-first, and `aggregate` rolls usage + cost across a slice. Every `TraceQuery` field is optional and ANDed together.

```ts
// What failed in the last hour?
const recentFailures = store.query({
  status: ["failed", "cancelled"],
  startedAfter: new Date(Date.now() - 3_600_000),
});

for (const trace of recentFailures) {
  console.log(
    `${trace.traceId} — ${trace.root.error?.type}: ${trace.root.error?.message}`,
  );

  // Walk the tree to find WHICH child span actually failed.
  for (const child of trace.root.children) {
    if (child.status === "failed") {
      console.log(`  ↳ failing span: ${child.name} (${child.type})`, {
        durationMs: child.duration,
        tokens: child.usage.total,
        error: child.error?.type,
      });
    }
  }
}

// Pull the one run the customer complained about by its trace id:
const theRun = store.get("run-abc-123");

// Roll up everything that happened in that customer's session:
const sessionStats = store.aggregate({ sessionId: "session-42" });

console.log(
  `${sessionStats.traces} runs, ` +
    `${sessionStats.failed} failed, ` +
    `${sessionStats.usage.total} tokens`,
);
```

## Teardown

Drain and release exporters on shutdown so any buffered backend sends its last records (the in-memory store needs no draining, but a co-registered file/Langfuse exporter does). Detaching removes only the listeners this subscriber added.

```ts
// On graceful shutdown:
detach();
await observe.shutdown(); // flush + release every registered exporter
```

## Other primitives, same shape

`attach` works identically on an agent, a workflow, or a supervisor — Panoptic subscribes to `agent.completed`, `workflow.completed`, and `supervisor.completed` by default and silently ignores the names a given target doesn't emit.

```ts
observe.attach(myWorkflow);   // workflow.completed
observe.attach(mySupervisor); // supervisor.completed
```

The orchestrator is the one exception: its events carry no result, so you feed its report in directly. See the [cost-dashboard recipe](./observability-trace-cost-dashboard) for that path via `observe.collect(result.report)`.

## Production notes

- **Observability faults never crash the run.** The collector wraps every exporter call in `Promise.allSettled`, and the event handler additionally swallows the `collect` rejection — a broken sink degrades to *missing telemetry*, never a failed agent run.
- **Bound the store in a long-lived process.** `createInMemoryTraceStore({ capacity: N })` evicts the oldest trace FIFO once the cap is exceeded; the default is unbounded, which leaks memory in a server. The store is intentionally index-free — `get`/`add` are O(1), `query`/`aggregate` are O(n) scans — so treat it as dev/test or modest-volume runtime retention, and export to a real datastore beyond that.
- **`completedEvents` narrows the surface.** Pass `panoptic({ exporters, completedEvents: ["agent.completed"] })` to attach to agents only and skip workflow/supervisor noise.
- **`attach` vs `middleware`.** If your app already composes cross-cutting concerns through the agent middleware pipeline, use `panoptic().middleware()` in the agent's `middleware` array instead of `attach` — same collector, different feed path. Pass a distinct `middlewareName` to register two Panoptic middlewares on one agent.

## Related

- [Observability — export to OTel & Langfuse](./observability-export-otel-langfuse) — ship the same traces to an external backend.
- [Observability — trace cost dashboard](./observability-trace-cost-dashboard) — per-run cost and latency from the collector.
- [Cost tracking](./cost-tracking) — the `usage.cost` per-channel breakdown Panoptic rolls up.
