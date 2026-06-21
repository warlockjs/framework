---
title: "@warlock.js/ai-panoptic"
description: Observability for @warlock.js/ai — a collector that projects report trees into traces and fans them out to OTEL, Langfuse, console, file, or a queryable store.
sidebar:
  order: 1
  label: "ai-panoptic"
---

`@warlock.js/ai-panoptic` is the **observability companion** to `@warlock.js/ai`. The core package already produces a rich `report` tree on every run — timings, status, rolled-up cost, the full nested trace. Panoptic takes that tree and ships it where your dashboards live: OpenTelemetry, Langfuse, the console, a JSON-Lines file, or an in-memory queryable store.

> Separate, optional package. `@warlock.js/ai` has no dependency on it. Install it only when you want traces exported.

```bash
npm install @warlock.js/ai-panoptic
```

This page is the **section overview** — it covers the pipeline, the `panoptic()` entry point, and the exporters at a glance. The three companion pages go deep on each stage: what a trace looks like, what each exporter emits, and how to query the in-memory store.

## The pipeline

```text
   run a primitive            project              fan out
┌──────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  BaseReport tree │ ──▶ │  collector   │ ──▶ │ console / file      │
│  (from ai.*)     │     │  → Trace     │     │ otel / langfuse     │
└──────────────────┘     └──────────────┘     │ in-memory store     │
                                              └─────────────────────┘
```

A `Trace` is a 1:1 projection of the core `BaseReport` tree into the span vocabulary shared by OTEL, Langfuse, and similar backends — identity, timing, outcome, and rolled-up cost. The collector flattens a report into spans without consulting anything else. See [What Panoptic traces look like](./what-panoptic-traces) for the full `Trace` / `TraceSpan` shape and the projection rules.

## `panoptic()` — the one-call entry point

`panoptic({ exporters })` builds a collector, registers the exporters, and hands back a subscriber with **three ways to feed it** — all converging on the same collector, so a trace reaches every exporter exactly once per run:

```ts
import { ai } from "@warlock.js/ai";
import { panoptic, consoleExporter, otelExporter } from "@warlock.js/ai-panoptic";

const observe = panoptic({
  exporters: [consoleExporter(), otelExporter({ tracerName: "app" })],
});
```

The three feed methods, in brief:

- **`attach(target)`** — subscribe to a primitive's terminal `*.completed` events so every run is captured automatically. Returns a detach function. Safe on agents, workflows, and supervisors; narrow or widen with `completedEvents`.
- **`middleware()`** — an `AgentMiddleware` that feeds the collector from the agent's `execute.after` / `onError` hooks, for apps that prefer the middleware pipeline over events. The hooks never mutate the result.
- **`collect(report)`** — feed a `BaseReport` directly. This is how you capture an orchestrator turn, whose `orchestrator.turn.*` events carry only session identity and no result-bearing report:

```ts
const result = await orchestrator.execute(input, { sessionId });
await observe.collect(result.report);
```

The subscriber also exposes `use(exporter)` (register more exporters), `toTrace(report)` (pure projection, no dispatch), `flush()`, and `shutdown()`. Call `shutdown()` on process teardown to flush durable exporters.

## Exporters at a glance

| Exporter | Ships | Optional peer |
| --- | --- | --- |
| `consoleExporter(opts?)` | Trace summary, or the full span tree with `{ tree: true }` | none (zero-dep) |
| `fileExporter({ path, flushEvery? })` | Buffered JSON-Lines append; `flushEvery` batches writes | none (zero-dep) |
| `otelExporter(opts?)` | Maps spans to OpenTelemetry GenAI semantic conventions (`gen_ai.*`) | `@opentelemetry/api` |
| `langfuseExporter(opts)` | Maps spans to Langfuse traces, generations, and spans | `langfuse` |

The OTEL and Langfuse exporters **lazily import** their SDKs — installing `@warlock.js/ai-panoptic` pulls in neither. Each throws an install-instruction error only if you build the exporter without the peer present.

```ts
import {
  consoleExporter, fileExporter, otelExporter, langfuseExporter,
} from "@warlock.js/ai-panoptic";

panoptic({
  exporters: [
    consoleExporter({ tree: true }),
    fileExporter({ path: "./traces.jsonl", flushEvery: 50 }),
    otelExporter({ tracerName: "my-app" }),     // or pass a pre-built { tracer }
    langfuseExporter({ publicKey, secretKey }), // or pass a pre-built { client }
  ],
});
```

For exactly what each exporter writes — the console tree format, the JSON-Lines record, the `gen_ai.*` attribute mapping, and the Langfuse object shapes — see [Exporter output](./exporter-output).

## Querying traces in-memory

`createInMemoryTraceStore()` is both a queryable `TraceStoreContract` and an `ExporterContract`, so you can register it as an exporter and then `query()` / `aggregate()` the traces it has captured — by `traceId`, `sessionId`, `status`, and time window. Use it for tests, local dashboards, or a lightweight in-process spend monitor; reach for the `otel` / `langfuse` exporters for durable backends. The query and aggregate API is covered in [Querying traces](./querying-traces).

## Continue reading

- [What Panoptic traces look like](./what-panoptic-traces) — the `Trace` / `TraceSpan` / `TraceSpanError` shape, how a `BaseReport` projects into spans, and the building-block projections (`reportToTrace()`, `reportToSpan()`, `extractSpanAttributes()`).
- [Exporter output](./exporter-output) — what each of `consoleExporter`, `fileExporter`, `otelExporter`, and `langfuseExporter` emits, plus the exporter utilities (`toGenAiAttributes()`, `walkSpans()`, `totalCostUsd()`, `GEN_AI_ATTRIBUTES` / `WARLOCK_ATTRIBUTES`).
- [Querying traces](./querying-traces) — the in-memory store's `query()` and `aggregate()` API, the `TraceQuery` filter fields, and the `TraceAggregate` result shape.

## Related

- [Orchestrators](../architecture-concepts/orchestrators) — collect orchestrator turns via `collect()`.
- [Log AI calls](../digging-deeper/log-ai-calls) — the `log`-channel side of observability.
- [Cost tracking recipe](../recipes/cost-tracking) — reading rolled-up `usage` directly off a report.
