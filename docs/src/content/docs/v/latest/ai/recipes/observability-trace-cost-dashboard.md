---
title: "Recipe — Build a trace cost & latency dashboard"
description: Query the @warlock.js/ai-panoptic collector and in-memory store for per-run cost and latency, including the orchestrator's direct-collect path.
sidebar:
  order: 22
  label: "Observability — cost dashboard"
---

Finance asks the question every AI team eventually hears: "What did this feature cost us last week, and which sessions were the expensive ones?" You have the runs — they flowed through your agents and orchestrator all week. What you need is to turn the retained traces into a few numbers: per-run cost, per-session spend, p95 latency, failure rate. No new instrumentation; just query what Panoptic already collected.

This recipe builds that dashboard view on top of the in-memory trace store — using `aggregate` for the rollups, `query` for the per-run drill-down, and the orchestrator's `collect` path so multi-turn sessions land in the same store as single-shot agents.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-panoptic
```

Pricing must be configured on the SDK (or per model) for cost to populate — an unpriced run reports `usage.cost === undefined`, and `aggregate().cost` stays `undefined` until at least one priced run lands. Honest absence over a false zero.

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
    "gpt-4o": { input: 5.0, output: 15.0 },
  },
});
```

## Collect from both an agent and an orchestrator

The agent emits a terminal `agent.completed` event, so `attach` captures it automatically. The **orchestrator** emits `orchestrator.turn.*` events that carry only session identity — no result — so you feed each turn's report in directly with `collect(result.report)`. Both converge on the same store.

```ts
import { ai } from "@warlock.js/ai";
import { panoptic, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore({ capacity: 50_000 });
const observe = panoptic({ exporters: [store] });

// 1) An agent — captured via the event stream.
const triageAgent = ai.agent({
  name: "ticket-triage",
  model: openai.model({ name: "gpt-4o-mini" }),
});

observe.attach(triageAgent);

// 2) An orchestrator — multi-turn session, collected directly per turn.
const supportBot = ai.orchestrator<{ resolved: boolean }>({
  name: "support-session",
  intents: {
    triage: triageAgent,
  },
  route: () => "triage",
  state: { resolved: false },
});
```

```ts
// Single-shot agent run — store fills via the attached event.
await triageAgent.execute("Card declined at checkout", {
  sessionId: "session-7",
});

// Orchestrator turn — no result-bearing event, so collect the report.
const turn = await supportBot.execute("I was double-charged", {
  sessionId: "session-7",
  history: [],
});

await observe.collect(turn.report);
```

## The dashboard query layer

A dashboard is a handful of `aggregate` / `query` calls. `aggregate(filter?)` rolls usage + cost + status counts over whatever the filter selects; `query(filter?)` returns the matching traces newest-started-first for the per-run table.

```ts
import type { TraceAggregate, TraceQuery } from "@warlock.js/ai-panoptic";
import { totalCostUsd } from "@warlock.js/ai-panoptic";

/** Collapse an aggregate's per-channel cost into one USD scalar. */
function aggregateCostUsd(stats: TraceAggregate): number {
  const cost = stats.cost;

  if (!cost) {
    return 0;
  }

  return (
    cost.input +
    cost.output +
    (cost.cachedInput ?? 0) +
    (cost.cachedOutput ?? 0)
  );
}

/** Top-line numbers for any slice (a week, a session, a status). */
function summarize(filter: TraceQuery) {
  const stats = store.aggregate(filter);

  return {
    runs: stats.traces,
    completed: stats.completed,
    failed: stats.failed,
    cancelled: stats.cancelled,
    failureRate: stats.traces === 0 ? 0 : stats.failed / stats.traces,
    totalTokens: stats.usage.total,
    cachedTokens: stats.usage.cachedTokens ?? 0,
    totalCostUsd: aggregateCostUsd(stats),
    totalDurationMs: stats.totalDuration,
    avgDurationMs: stats.traces === 0 ? 0 : stats.totalDuration / stats.traces,
  };
}
```

### Week-to-date totals

```ts
const startOfWeek = new Date();
startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
startOfWeek.setHours(0, 0, 0, 0);

const week = summarize({ startedAfter: startOfWeek });

console.log(
  `This week: ${week.runs} runs, ` +
    `$${week.totalCostUsd.toFixed(4)}, ` +
    `${(week.failureRate * 100).toFixed(1)}% failed, ` +
    `avg ${Math.round(week.avgDurationMs)}ms`,
);
```

### The per-run table (with p95 latency)

`aggregate` gives you the rollup but not percentiles — those come from walking the queried traces, where each trace's root carries the whole-run cost and duration.

```ts
function perRunRows(filter: TraceQuery) {
  return store.query(filter).map((trace) => ({
    traceId: trace.traceId,
    sessionId: trace.sessionId,
    type: trace.root.type, // "agent" | "workflow" | "orchestrator" | ...
    status: trace.root.status,
    startedAt: trace.startedAt,
    durationMs: trace.duration,
    tokens: trace.usage.total,
    costUsd: totalCostUsd(trace.usage) ?? 0, // root usage = whole-run rollup
  }));
}

function p95(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;

  return sorted[Math.min(index, sorted.length - 1)];
}

const rows = perRunRows({ startedAfter: startOfWeek });
const p95LatencyMs = p95(rows.map((row) => row.durationMs));

console.log(`p95 latency: ${Math.round(p95LatencyMs)}ms`);
```

### Drill into one expensive session

```ts
const sessionStats = summarize({ sessionId: "session-7" });

console.log(
  `session-7: $${sessionStats.totalCostUsd.toFixed(4)} ` +
    `over ${sessionStats.runs} runs`,
);

// Find the single most expensive run in that session:
const ranked = perRunRows({ sessionId: "session-7" }).sort(
  (a, b) => b.costUsd - a.costUsd,
);

console.log("priciest run:", ranked[0]);
```

### Where did the cost go inside a run?

For a flame-graph-style cost attribution, walk one trace's span tree — each span carries its own rolled-up `usage`, so you can see which trip or tool dominated.

```ts
import { walkSpans } from "@warlock.js/ai-panoptic";

const trace = store.get(ranked[0].traceId);

if (trace) {
  for (const span of walkSpans(trace.root)) {
    console.log(
      `${span.type}:${span.name} — ` +
        `${span.duration}ms, ` +
        `$${(totalCostUsd(span.usage) ?? 0).toFixed(5)}`,
    );
  }
}
```

## Failure cost — the question finance actually asked next

"How much are we spending on runs that fail?" is one filter away, because `status` accepts an array:

```ts
const failedSpend = summarize({
  status: ["failed", "cancelled"],
  startedAfter: startOfWeek,
});

console.log(
  `Burned $${failedSpend.totalCostUsd.toFixed(4)} on ` +
    `${failedSpend.runs} failed/cancelled runs this week`,
);
```

## Production notes

- **`aggregate` sums each trace's root `usage`**, which is already a rollup of own cost + children — so the totals reflect the whole run tree without re-walking spans. `input` / `output` / `total` are always present; the optional `cachedTokens` / `reasoningTokens` / `cacheWriteTokens` channels are summed only when a matched run reported them.
- **`completed + failed + cancelled` need not equal `traces`.** Non-terminal statuses (`awaiting-input` from a paused orchestrator session, `max-iterations`) count toward `traces` but none of the three headline counters — guard your failure-rate math against that, as `summarize` does by dividing `failed / traces`.
- **`cost` stays `undefined` until something is priced.** An unpriced run never erases the cost of priced siblings (the merge uses the framework's own cost-rollup logic), so a single unpriced model in the mix won't zero out your dashboard — it just won't contribute.
- **The in-memory store is O(n) on `query` / `aggregate`** with no secondary indexes — perfect for a dev dashboard or a modest-volume admin panel, but for a high-traffic finance report back it with a real datastore: write a custom `TraceStoreContract`, or export traces to a warehouse via the [OTel / Langfuse exporters](./observability-export-otel-langfuse) and aggregate there.
- **Bound retention** with `createInMemoryTraceStore({ capacity })` in any long-lived process; the default keeps everything until `clear()`.

## Related

- [Observability — wire Panoptic](./observability-wire-panoptic) — attach the subscriber and the store query basics.
- [Observability — export OTel & Langfuse](./observability-export-otel-langfuse) — ship traces to a backend and aggregate at warehouse scale.
- [Cost tracking](./cost-tracking) — configuring `pricing` and the `usage.cost` per-channel shape.
