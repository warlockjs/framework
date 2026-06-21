# `@warlock.js/ai-panoptic` — skills index

Per-task skills. All cross-references use the form `@warlock.js/<pkg>/<skill>/SKILL.md`.

## Skills

### [`observe-with-panoptic/`](./observe-with-panoptic/SKILL.md)

Wire Panoptic into a run with the one-call `panoptic({ exporters })` subscriber — `attach()` to an agent/workflow/supervisor event stream (every run captured automatically), `middleware()` for the agent pipeline, or `collect()` a report directly (the orchestrator turn). Covers the three feed paths, the default `*.completed` event surface and `completedEvents` override, failure isolation, `flush()` / `shutdown()`, and bringing your own collector/store. Load when attaching observability to a primitive, adding a tracing middleware, or collecting an orchestrator turn report.

### [`export-traces/`](./export-traces/SKILL.md)

Send Panoptic traces to an observability backend via pluggable exporters — `consoleExporter` / `fileExporter` (zero-dep) and `otelExporter` (OpenTelemetry GenAI semantic conventions) / `langfuseExporter` (both lazily import their optional-peer SDK). Covers picking an exporter, the `ExporterContract`, the `gen_ai.*` / `warlock.*` attribute mapping, the shared `walkSpans` / `toGenAiAttributes` / `totalCostUsd` utilities, and authoring a custom exporter. Load when wiring `collector.use(...)` with an exporter, exporting to OTel / Langfuse / console / a file, or writing a custom sink.

### [`query-traces/`](./query-traces/SKILL.md)

Retain traces in the queryable in-memory store and slice them after the fact — `createInMemoryTraceStore` (doubles as an `ExporterContract`), `get` / `query` / `aggregate` / `clear` / `size`, the `TraceQuery` filter (id / session / status / time window), the `TraceAggregate` usage + cost + status rollup, `capacity` FIFO eviction, and the pure `sumUsage` / `emptyUsage` / `matchTrace` helpers. Load when querying collected traces, aggregating AI cost/usage per session, listing failed runs, or retaining traces in memory.
