---
title: Querying traces
description: Retain @warlock.js/ai-panoptic traces in a queryable in-memory store — register createInMemoryTraceStore() as an exporter, then query() by id/session/status/time and aggregate() usage + cost, plus the building blocks (createCollector, reportToTrace/reportToSpan, walkSpans, totalCostUsd, a custom ExporterContract) for bespoke pipelines.
---

Exporters ship a trace *out* to a backend. A **trace store** does the opposite: it keeps each completed trace in memory so you can answer observability questions after the fact — pull one run by id, list every run for a session, slice failed runs in a time window, or roll usage and cost across any of those slices.

`createInMemoryTraceStore()` is the shipped store. It returns one object that satisfies **both** contracts at once:

- an `ExporterContract` — so you register it on the collector like any other sink and it fills as traces complete;
- a `TraceStoreContract` — so the same handle is what you `query()` and `aggregate()` later.

There is no separate "register" and "read" object — the store you wire in *is* the store you query.

## Register it, then query it

Because the store is an exporter, wiring it in is a single entry in the `exporters` array:

```ts
import { panoptic, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();

// The store doubles as an exporter — register it like any other sink.
const observe = panoptic({ exporters: [store] });

const agent = ai.agent({ model });
observe.attach(agent);

await agent.execute("Summarize this");

// ...later, off the hot path, the same handle is queryable:
const failed = store.query({ status: "failed" });
const spend = store.aggregate({ sessionId: "session-42" });
```

If you build your own collector, `use()` the store on it and hand that collector to `panoptic`:

```ts
import { panoptic, createCollector, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const observe = panoptic({ collector: createCollector().use(store) });
```

## The store surface

`createInMemoryTraceStore()` returns a `TraceStoreContract & ExporterContract`:

```ts
interface TraceStoreContract {
  add(trace: Trace): void;                        // ingest; overwrites same traceId
  get(traceId: string): Trace | undefined;        // one run by id
  query(filter?: TraceQuery): Trace[];            // matching traces, newest-started first
  aggregate(filter?: TraceQuery): TraceAggregate; // usage + cost + status rollup
  readonly size: number;                          // retained count
  clear(): void;                                  // drop everything
}
```

- The `ExporterContract` side adds `name` (`"in-memory-trace-store"`) and `export(trace)`, which is just an alias for `add` — that is what lets the store be a drop-in exporter.
- `add` **overwrites** any existing trace with the same `traceId`, so re-collecting a run replaces rather than duplicates it.
- `query` returns traces **newest-started first** (sorted by root `startedAt`, descending). An empty or omitted filter returns every retained trace.

## Filtering with `TraceQuery`

Every field is optional and **ANDed** together — an absent field means "don't care", so `{}` matches everything. The same filter type drives both `query` and `aggregate`.

```ts
type TraceQuery = {
  traceId?: string;                       // exact one run
  sessionId?: string;                     // every run for a session
  status?: ReportStatus | ReportStatus[]; // single status or membership set
  startedAfter?: string | Date;           // inclusive lower bound on root startedAt
  startedBefore?: string | Date;          // inclusive upper bound on root startedAt
};
```

```ts
// One run by id:
store.query({ traceId: "run-abc" });

// Every run for a conversation:
store.query({ sessionId: "session-42" });

// Failed or cancelled runs since midnight (status accepts an array):
store.query({
  status: ["failed", "cancelled"],
  startedAfter: "2026-06-18T00:00:00.000Z",
});

// A Date works anywhere a time bound is accepted — the last hour:
store.query({ startedAfter: new Date(Date.now() - 3_600_000) });
```

Time bounds compare against each trace's root `startedAt`, **inclusive on both ends**, and accept either an ISO-8601 string or a `Date`. Status is exact equality, or array membership when you pass an array. The pure matcher behind all of this is `matchTrace(trace, filter)` — exported so you can filter a list of traces you already hold yourself.

## Rolling up with `aggregate`

`aggregate(filter?)` answers the headline questions — how many runs, how many tokens, how much did it cost, how many failed — for whatever slice the filter selects. It returns a `TraceAggregate`:

```ts
type TraceAggregate = {
  traces: number;        // matched count
  completed: number;     // root status === "completed"
  failed: number;        // root status === "failed"
  cancelled: number;     // root status === "cancelled"
  usage: Usage;          // summed token usage (input / output / total always present)
  cost?: ModelPricing;   // merged per-channel USD, or undefined if no trace was priced
  totalDuration: number; // summed wall-clock ms
};
```

```ts
const stats = store.aggregate({ sessionId: "session-42" });

console.log(`${stats.traces} runs, ${stats.usage.total} tokens, ${stats.failed} failed`);

const totalUsd =
  (stats.cost?.input ?? 0) +
  (stats.cost?.output ?? 0) +
  (stats.cost?.cachedInput ?? 0) +
  (stats.cost?.cachedOutput ?? 0);
```

Things that matter when you read the numbers:

- **`usage`** sums each trace's *root* `Usage` (already a rollup of its own cost plus its children), so the totals reflect the whole run tree without re-walking spans. `input` / `output` / `total` are always present (zero when nothing matched); the optional `cachedTokens` / `cacheWriteTokens` / `reasoningTokens` channels are summed only when at least one matched trace reported them.
- **`cost`** is a per-channel `ModelPricing` breakdown (not one opaque number), merged with the framework's own cost-rollup logic, so an unpriced trace never erases the cost of priced ones. It stays `undefined` only when **no** matched trace carried pricing.
- **`completed` + `failed` + `cancelled` need not equal `traces`** — non-terminal statuses (`awaiting-input`, `max-iterations`) count toward `traces` but none of the three headline counters.
- An empty match returns a zeroed aggregate (`usage` all `0`, `cost` `undefined`, `totalDuration` `0`).

## A tiny in-process spend monitor

Because the store is queryable in-process, a "did this session get expensive?" guard is a few lines — no external dashboard, no extra dependency. Register the store, then read `aggregate` against the session id whenever you want a verdict:

```ts
import { panoptic, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const observe = panoptic({ exporters: [store] });

/** USD spent so far on one session, summed across every priced channel. */
function sessionSpendUsd(sessionId: string): number {
  const { cost } = store.aggregate({ sessionId });

  if (!cost) {
    return 0; // nothing priced yet
  }

  return (
    (cost.input ?? 0) +
    (cost.output ?? 0) +
    (cost.cachedInput ?? 0) +
    (cost.cachedOutput ?? 0)
  );
}

/** Throw once a session crosses its budget — call after each turn. */
function assertWithinBudget(sessionId: string, limitUsd: number): void {
  const spent = sessionSpendUsd(sessionId);

  if (spent > limitUsd) {
    throw new Error(`Session ${sessionId} spent $${spent.toFixed(4)}, over the $${limitUsd} cap`);
  }
}
```

```ts
const agent = ai.agent({ model });
observe.attach(agent);

await agent.execute("Draft the reply", { sessionId: "session-42" });

assertWithinBudget("session-42", 0.5); // gate the next turn on the running total
```

Every `aggregate` is an O(n) scan over retained traces — cheap for the dev/test and modest-volume runtime use this store targets, and entirely off the agent's hot path.

### Bounding retention with `capacity`

The store is unbounded by default (keep everything until `clear()`). For a long-lived process, cap it — once the cap is exceeded, the oldest-ingested trace is evicted FIFO:

```ts
type InMemoryTraceStoreOptions = { capacity?: number }; // absent / 0 = unbounded

const store = createInMemoryTraceStore({ capacity: 1000 });
```

Overwriting an existing `traceId` refreshes its insertion position, so a re-collected run counts as newest for eviction.

## Summing usage yourself

`sumUsage` / `emptyUsage` are the pure folds `aggregate` is built on. Reuse them to roll a `Usage` set the store didn't produce — for example over a list of traces you filtered by hand:

```ts
import { emptyUsage, sumUsage } from "@warlock.js/ai-panoptic";

let total = emptyUsage(); // { input: 0, output: 0, total: 0 } — optional channels absent
for (const trace of store.query({ sessionId: "session-42" })) {
  total = sumUsage(total, trace.usage);
}
```

`sumUsage` is pure (returns a fresh `Usage`, mutates neither argument): the token channels always sum; the optional cache / reasoning channels sum only when a side reported them; `cost` merges with the framework's cost-rollup logic so an unpriced contributor never erases a priced one.

## Building blocks for custom pipelines

Most apps only need `panoptic(...)`, an exporter or two, and the store above. When you want a bespoke pipeline — a custom sink, an out-of-band projection, your own retention layer — these lower-level exports are the same primitives the shipped pieces are built from. Each is a pure function over the report tree (or a thin factory), so they compose without surprises.

### `createCollector()` — the source end by hand

`panoptic(...)` wraps a collector for you; reach for `createCollector()` when you want to own it directly. Register sinks with `use(...)`, feed it finalized root reports with `collect(...)`, and drain it with `shutdown()`:

```ts
import { createCollector, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const collector = createCollector().use(store);

agent.on("agent.completed", ({ result }) => collector.collect(result.report));

// on teardown, so buffered exporters drain:
await collector.shutdown();
```

The collector dedupes exporters by `name`, isolates a throwing exporter (one bad sink never crashes the originating run), and exposes `toTrace(report)` for a pure projection without dispatching.

### `reportToTrace()` / `reportToSpan()` — project a finished report

When you already hold a finished `result.report` and just want the vendor-neutral shape — no live subscriber, no collector — project it directly:

```ts
import { reportToTrace, reportToSpan } from "@warlock.js/ai-panoptic";

const trace = reportToTrace(result.report); // full Trace: root span + trace-wide rollups
const root = reportToSpan(result.report);   // just the root TraceSpan (recurses into children)

console.log(trace.traceId, trace.usage.total, trace.duration);
```

`reportToTrace` builds the root span (via `reportToSpan`) plus the trace-wide rollups (`traceId`, `sessionId`, `usage`, timing); `reportToSpan` projects one node — and its whole subtree — into a `TraceSpan`. Both are pure: the same input always yields the same output. This is exactly what the collector does internally, exposed so you can normalize a captured report out of band.

### `walkSpans()` — flatten the span tree

A `Trace` is a tree (`trace.root` with nested `children`). `walkSpans(root)` is the depth-first pre-order traversal that yields the root first, then each descendant in invocation order — so a flat-stream sink writes the recursion once:

```ts
import { walkSpans } from "@warlock.js/ai-panoptic";

for (const span of walkSpans(trace.root)) {
  console.log(span.spanId, span.type, span.status, span.usage.total);
}
```

### `totalCostUsd()` — one span's cost as a scalar

`totalCostUsd(usage)` collapses a span's per-channel `usage.cost` breakdown into a single USD number by summing every populated channel. It returns `undefined` when no pricing was attached, so you can omit the cost entirely rather than print a misleading `0`:

```ts
import { totalCostUsd } from "@warlock.js/ai-panoptic";

const cost = totalCostUsd(trace.root.usage); // number | undefined
if (cost !== undefined) {
  console.log(`$${cost.toFixed(4)}`);
}
```

### A custom `ExporterContract`

`name` + `export` are the only required members. The collector awaits `export`, isolates it on failure, and calls the optional `flush` / `shutdown` when present. Combine the building blocks above to ship whatever shape your backend wants:

```ts
import type { ExporterContract, Trace } from "@warlock.js/ai-panoptic";
import { walkSpans, totalCostUsd } from "@warlock.js/ai-panoptic";

const spendLogExporter: ExporterContract = {
  name: "spend-log",
  export(trace: Trace) {
    for (const span of walkSpans(trace.root)) {
      const cost = totalCostUsd(span.usage);

      if (cost !== undefined) {
        console.log(`${span.type} "${span.name}" — $${cost.toFixed(4)}`);
      }
    }
  },
};

const collector = createCollector().use(spendLogExporter);
```

If your exporter wraps a third-party SDK, lazily `await import(...)` it **inside** the `export` path (never at module top level) so it stays an optional peer dependency — copy the loader pattern from the shipped `otelExporter` / `langfuseExporter`. See [Export traces](/v/latest/ai/observability/exporter-output/) for the full exporter walkthrough.

## See also

- [What Panoptic traces](/v/latest/ai/observability/what-panoptic-traces/) — the `Trace` / `TraceSpan` shape this store retains.
- [Exporter output](/v/latest/ai/observability/exporter-output/) — sending traces to a backend instead of (or alongside) retaining them in memory.
