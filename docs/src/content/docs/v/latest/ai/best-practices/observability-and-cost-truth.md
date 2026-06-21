---
title: "Best Practices — Observability and cost truth"
sidebar:
  label: "Observability and cost truth"
description: Attach Panoptic to every production run, export to OTel or Langfuse in prod and console or file in dev, set ModelPricing so cost is honest, attribute spend per tenant from the rolled-up Usage.cost, and use the trace tree for forensics — wire tracing before you scale.
---

The pillar this page answers: **when a production AI run misbehaves or the bill spikes, can you say exactly what happened and exactly what it cost — per run, per session, per tenant?**

If the answer is "we'd have to add logging and reproduce it," you wired observability too late. The discipline is to make every run leave a complete, queryable trace and an honest cost number *by default* — attached once at boot, off the request's hot path, before the traffic that makes you need it. Everything below is one running scenario.

## The running scenario

A multi-tenant SaaS support product. Every customer hits the same agent flow — triage, order lookup, a refund decision, a final reply — over a multi-turn session. Two things go wrong in week one: a tenant reports a run that "just hung," and finance asks why the OpenAI bill is double last month's. You need the failing run's execution tree on demand, and you need to attribute spend to the tenant and feature that incurred it. `@warlock.js/ai-panoptic` is the package that gives you both from one wiring.

The flow runs on two model tiers from one SDK, **with pricing set** so cost is computed at emit time:

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  // ModelPricing is USD per 1,000,000 tokens — the industry-standard unit.
  // With pricing present, every report carries a Usage.cost breakdown.
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  },
});

const cheap = openai.model({ name: "gpt-4o-mini" });
const strong = openai.model({ name: "gpt-4o" });
```

## Attach Panoptic to every production run — not just the one you're debugging

The whole point of Panoptic is that capture is automatic and ambient. You build a subscriber once with `panoptic({ exporters })`, `attach` it to each primitive, and every run — completed, failed, or cancelled — flows to every registered exporter exactly once. You write zero observability code in the request handler.

**Do this — one subscriber, attached at boot, capturing every outcome.** `attach` subscribes to the primitive's terminal `*.completed` event, which fires once per run regardless of outcome. The failing run is already captured before your error branch runs.

```ts
import {
  panoptic,
  createInMemoryTraceStore,
  consoleExporter,
} from "@warlock.js/ai-panoptic";

const supportAgent = ai.agent({ name: "refund-support", model: strong });

// Retain runs locally AND echo a one-line summary — wired once, at boot.
const store = createInMemoryTraceStore({ capacity: 50_000 });
const observe = panoptic({ exporters: [store, consoleExporter()] });

const detach = observe.attach(supportAgent); // every run captured from here on

// In the handler you just run the agent — no per-call tracing code.
const { data, error } = await supportAgent.execute(message, { sessionId });
```

**Avoid this — instrumenting one run by hand after it breaks.** Wrapping a single `execute` in ad-hoc timing and logging captures *that* call shape and nothing else: no child-span tree, no cost rollup, no failed/cancelled runs, and none of the runs that broke before you added it.

```ts
// Anti-pattern: bespoke, per-call, lossy — and only on the path you remembered.
const start = Date.now();
try {
  const result = await supportAgent.execute(message, { sessionId });
  logger.info({ ms: Date.now() - start, tokens: result.usage.total });
} catch (e) {
  logger.error(e); // no tree, no cost, no parent/child lineage
}
```

> `attach` works identically on an agent, workflow, or supervisor — Panoptic defaults to `agent.completed`, `workflow.completed`, `supervisor.completed` and silently ignores the names a target doesn't emit. The **orchestrator** is the one exception: its turn events carry no result, so feed each turn's report directly with `observe.collect(turn.report)`. See the [wire Panoptic recipe](../recipes/observability-wire-panoptic).

## Export to OTel or Langfuse in prod; console or file in dev

The same subscriber fans one trace out to many backends. The recommendation is environment-shaped: in production ship to the backend your platform team already runs (an OpenTelemetry collector — Tempo, Honeycomb, Datadog) and/or Langfuse for prompt-level inspection; in development keep it local with `consoleExporter` or `fileExporter`. Both wire exporters lazily import their SDK, so they stay **optional peers** — install only the backends you actually use.

**Do this — pick exporters by environment, behind one factory.** Production gets durable backends plus a retention store; dev gets a readable console tree. One `panoptic({ exporters })` shape either way.

```ts
import {
  panoptic,
  createInMemoryTraceStore,
  consoleExporter,
  otelExporter,
  langfuseExporter,
} from "@warlock.js/ai-panoptic";

function buildObservability() {
  if (process.env.NODE_ENV === "production") {
    return panoptic({
      exporters: [
        // OTel: the exporter emits onto a Tracer; your app owns the SDK
        // (provider + OTLP exporter). `system` backfills gen_ai.system.
        otelExporter({ tracerName: "support-app", system: "openai" }),
        langfuseExporter({
          publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
          secretKey: process.env.LANGFUSE_SECRET_KEY!,
          baseUrl: process.env.LANGFUSE_HOST, // optional; SDK default otherwise
        }),
        createInMemoryTraceStore({ capacity: 50_000 }), // local query surface
      ],
    });
  }

  // Dev: a readable tree on stdout, no external SDK required.
  return panoptic({ exporters: [consoleExporter({ tree: true })] });
}

const observe = buildObservability();
observe.attach(supportAgent);
```

**Avoid this — leaving production runs in the console.** `consoleExporter` is a development affordance: it can't be queried, sliced by session, or aggregated for a cost report, and at production volume it just floods stdout. A `console.log` is not a trace backend.

```ts
// Anti-pattern: the dev exporter shipped to prod — unqueryable, unsliceable noise.
const observe = panoptic({ exporters: [consoleExporter()] });
```

> A missing optional-peer SDK surfaces as a curated *"install this"* error on first export, never a boot-time stack trace — so you can register `otelExporter` without `langfuse` installed and vice versa. The OTel exporter never owns a `TracerProvider`; provider, processors, and the OTLP span exporter are your existing instrumentation, so AI spans land in the same pipeline as the rest of your service. Full setup in the [export to OTel & Langfuse recipe](../recipes/observability-export-otel-langfuse).

## Set ModelPricing so cost is computed honestly — never zero

Cost truth starts at the SDK. With a `ModelPricing` registry configured, the framework computes `Usage.cost` at emit time from `tokens × pricing[model]` and stamps it onto the report as a **historical fact** — so a stored run stays accurate even after the upstream pricing table changes. Without pricing, `Usage.cost` is `undefined`, and the right reaction is honest absence, never a fabricated `0`.

**Do this — price every model you run, and treat `undefined` as "unknown," not "free."** Pricing per 1M tokens on the SDK; per-model override wins where a tenant has contract pricing.

```ts
import type { Usage } from "@warlock.js/ai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  },
});

// Usage.cost has the ModelPricing shape — sum the populated channels for a scalar.
function runCostUsd(usage: Usage): number {
  const cost = usage.cost;

  if (!cost) {
    return 0; // unpriced run — record it as unknown, don't invent a number
  }

  return cost.input + cost.output + (cost.cachedInput ?? 0) + (cost.cachedOutput ?? 0);
}
```

**Avoid this — coercing a missing cost to `0` and summing it into a total.** An unpriced model (a new finetune, a legacy adapter) reporting `usage.cost === undefined` silently becomes free in your dashboard. The result is a cost report that *looks* complete and *is* wrong — the worst failure mode, because nobody questions a number.

```ts
// Anti-pattern: undefined → 0 hides unpriced spend behind a confident total.
const total = result.usage.cost?.input ?? 0; // and the rest of the bill vanishes
```

> Panoptic's rollups follow the same honesty rule: `aggregate().cost` stays `undefined` until at least one priced run lands, and an unpriced child can never erase the cost of priced siblings — the merge uses the framework's own cost-rollup logic. So one unpriced model in the mix won't zero out your dashboard; it just won't contribute. See the [cost tracking recipe](../recipes/cost-tracking) for the `pricing` shape and resolution order.

## Read the rolled-up `Usage.cost` to attribute spend per tenant or feature

"We spent $4,200 on OpenAI" answers no one's question. The question is *which tenant, which feature, which model* — and the answer is already on every result, because `Usage` rolls up the whole run tree. Stamp each run with the dimension you bill by (the tenant id as `sessionId`, the feature as part of it), then roll the per-channel `Usage.cost` into a keyed ledger.

**Do this — stamp the tenant, read the per-channel breakdown, roll it up.** `cachedTokens` (cheap cache hits) and `reasoningTokens` (expensive thinking) are separate channels, so you can tell *why* a tenant is costly, not just *that* they are.

```ts
const sessionId = `tenant_${tenantId}:refund-flow`; // tenant + feature in one key

const { usage } = await supportAgent.execute(message, { sessionId });

await tenantLedger.add(tenantId, {
  feature: "refund-flow",
  model: "gpt-4o",
  inputTokens: usage.input,
  outputTokens: usage.output,
  cachedTokens: usage.cachedTokens ?? 0,       // billed at the cached rate
  reasoningTokens: usage.reasoningTokens ?? 0, // counted within output
  // Usage.cost has no single scalar — sum the populated channels.
  costUsd: usage.cost
    ? usage.cost.input +
      usage.cost.output +
      (usage.cost.cachedInput ?? 0) +
      (usage.cost.cachedOutput ?? 0)
    : 0,
});
```

Or let the in-memory store do the rollup — `aggregate(filter)` sums every matched run's root `usage` (already a tree rollup) and merges the per-channel cost:

```ts
import { totalCostUsd } from "@warlock.js/ai-panoptic";

// Every run for one tenant, in one call — Panoptic kept them via the store.
const stats = store.aggregate({ sessionId: `tenant_${tenantId}:refund-flow` });

const tenantUsd =
  stats.cost === undefined
    ? 0
    : stats.cost.input +
      stats.cost.output +
      (stats.cost.cachedInput ?? 0) +
      (stats.cost.cachedOutput ?? 0);

console.log(
  `${tenantId}: ${stats.traces} runs, ` +
    `${stats.usage.cachedTokens ?? 0} cached tokens, $${tenantUsd.toFixed(4)}`,
);
```

**Avoid this — billing from one opaque provider invoice.** The provider's monthly total can't be split by tenant or feature after the fact. If you didn't stamp the dimension at run time, no amount of querying recovers it — you're left allocating a lump sum by guesswork.

> The dimension has to be on the run when it executes — `sessionId` is the join key Panoptic mirrors onto every span (`gen_ai.conversation.id` in OTel, the session dimension in Langfuse). Pick a scheme that encodes tenant *and* feature so one filter answers both finance's and engineering's questions. See the [cost per tenant recipe](../recipes/cost-aggregate-per-tenant) for the full ledger.

## Use the trace tree — children and lineage — for forensics

When a run fails, the flat error tells you *that* it failed; the trace tree tells you *where*. Every `TraceSpan` carries `parentSpanId` / `traceId` lineage and a `children` array in invocation order, and each span has its own rolled-up `usage` — so you can pinpoint the failing trip or the expensive tool without re-running anything.

**Do this — pull the run by id and walk its tree.** `store.get(traceId)` returns the retained run; `walkSpans` does the depth-first traversal so you can attribute failure and cost span by span.

```ts
import { walkSpans, totalCostUsd } from "@warlock.js/ai-panoptic";

// The tenant's "it just hung" run — pulled by id, no reproduction needed.
const trace = store.get(traceId);

if (trace) {
  for (const span of walkSpans(trace.root)) {
    const failed = span.status === "failed" || span.status === "cancelled";

    console.log(
      `${span.type}:${span.name} — ${span.duration}ms, ` +
        `$${(totalCostUsd(span.usage) ?? 0).toFixed(5)}` +
        (failed ? `  <-- ${span.error?.type}: ${span.error?.message}` : ""),
    );
  }
}
```

You can also slice by outcome across all retained runs — `status` accepts an array, so "what failed in the last hour, and what did it cost" is one query:

```ts
const recentFailures = store.query({
  status: ["failed", "cancelled"],
  startedAfter: new Date(Date.now() - 3_600_000),
});

for (const failure of recentFailures) {
  // Each child span is a candidate culprit — the tree localizes the fault.
  const culprit = failure.root.children.find((child) => child.status === "failed");
  console.log(`${failure.traceId} — failing span: ${culprit?.name} (${culprit?.type})`);
}
```

**Avoid this — reconstructing the run from scattered log lines.** Grepping a request id across services gives you fragments in arrival order, not the parent/child structure. You can't tell which trip the model looped on or which tool burned the tokens, because the lineage was never captured — it was thrown away at log time.

> The root span's `usage` is the whole-run rollup; each child's `usage` is its own subtree's rollup. That is what makes a span tree a flame graph for cost: the expensive node is the one whose own rollup dominates its parent's. For a cost-and-latency dashboard built entirely on `query` / `aggregate` / `walkSpans`, see the [trace cost dashboard recipe](../recipes/observability-trace-cost-dashboard).

## Wire tracing before you scale — and flush it on shutdown

Observability you add *after* an incident can't explain the incident. Wire it on day one so the traffic that eventually surprises you is already captured. The two operational requirements: bound any in-memory retention so a long-lived process doesn't leak, and flush exporters on shutdown so the last buffered records actually leave the box.

**Do this — bound the store and drain exporters on teardown.** `capacity` caps memory with FIFO eviction; `shutdown()` flushes and releases every registered exporter (the Langfuse client and any batching backend hold buffered observations).

```ts
const observe = panoptic({
  exporters: [
    createInMemoryTraceStore({ capacity: 50_000 }), // bounded — FIFO eviction
    otelExporter({ tracerName: "support-app" }),
    langfuseExporter({ client: langfuse }),
  ],
});

const detach = observe.attach(supportAgent);

// On graceful shutdown — drain buffers before the process exits.
process.on("SIGTERM", async () => {
  detach();
  await observe.shutdown(); // flush + release every exporter; last records sent
});
```

**Avoid this — an unbounded store in a server, with no flush.** The default in-memory store keeps every trace until `clear()`, so an always-on process leaks until OOM; and skipping `shutdown()` drops whatever Langfuse or a batching exporter had buffered — the exact traces from the final minutes before a crash, which are the ones you most want.

```ts
// Anti-pattern: unbounded retention + abrupt exit = a leak that drops its tail.
const observe = panoptic({ exporters: [createInMemoryTraceStore()] });
// ...no detach, no shutdown — process.exit() loses buffered traces.
```

> Observability faults never crash the run: the collector wraps every exporter in `Promise.allSettled`, and the event handler swallows the `collect` rejection — a broken sink degrades to *missing telemetry*, never a failed agent. The in-memory store is O(n) on `query` / `aggregate` with no secondary indexes, so treat it as a dev/test and modest-volume runtime surface; beyond that, export to a warehouse via OTel / Langfuse and aggregate there.

## Avoid list

The short version — the gaps that leave you blind or holding a wrong number:

- **Don't instrument one run by hand after it breaks.** Attach `panoptic({ exporters })` once at boot so every run — completed, failed, cancelled — is captured with its full tree.
- **Don't ship the console exporter to production.** It can't be queried, sliced, or aggregated; use OTel and/or Langfuse in prod and keep `consoleExporter` / `fileExporter` for dev.
- **Don't run unpriced models and let `Usage.cost` default to `0`.** Set `ModelPricing` on the SDK; treat `undefined` cost as unknown, never free.
- **Don't bill from the provider's lump-sum invoice.** Stamp `sessionId` with tenant + feature at run time and roll up the per-channel `Usage.cost` — the dimension can't be recovered later.
- **Don't reconstruct a failure from scattered logs.** Pull the run with `store.get(traceId)` and walk `children` / `walkSpans` for parent/child lineage and per-span cost.
- **Don't leave an unbounded store or skip `shutdown()`.** Bound retention with `capacity` and flush exporters on teardown so the last records aren't lost.
- **Don't wire tracing after you scale.** Observability added post-incident can't explain the incident — wire it before the traffic arrives.

## See also

- [Recipe — Wire Panoptic onto a run](../recipes/observability-wire-panoptic) — attach the subscriber and retain traces in the in-memory store.
- [Recipe — Export to OTel & Langfuse](../recipes/observability-export-otel-langfuse) — ship the same traces to an external backend with optional-peer install notes.
- [Recipe — Trace cost & latency dashboard](../recipes/observability-trace-cost-dashboard) — per-run cost, p95 latency, and failure cost from the collector.
- [Recipe — Aggregate cost per tenant](../recipes/cost-aggregate-per-tenant) — read `Usage.cost` / `cachedTokens` / `reasoningTokens` into a tenant ledger.
- [Recipe — Cost tracking](../recipes/cost-tracking) — the `ModelPricing` registry and the `Usage.cost` per-channel breakdown.
- [Best Practices — Cost and efficiency](./cost-and-efficiency) — the levers (tiering, caching, budgets) that lower the spend you're now measuring.
- [Architecture — Middleware](../architecture-concepts/middleware) — the pipeline `panoptic().middleware()` plugs into as an alternative feed path.
