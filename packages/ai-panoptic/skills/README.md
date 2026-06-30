# `@warlock.js/ai-panoptic` — skills index

Per-task skills. All cross-references use the form `@warlock.js/<pkg>/<skill>/SKILL.md`.

## Skills

### [`observe-with-panoptic/`](./observe-with-panoptic/SKILL.md)

Wire Panoptic into a run — declaratively via `ai.config({ panoptic })` (registers panoptic on core's `Observer` seam; `observeAll` + per-flow `observe` decide which workflow/supervisor/team runs route in), or imperatively with the one-call `panoptic({ exporters })` subscriber (`attach()` to an event stream, `middleware()` for the agent pipeline, or `collect()` a report directly — the orchestrator turn). Covers the side-effect import, the three imperative feed paths, the default `*.completed` event surface and `completedEvents` override, failure isolation, `flush()` / `shutdown()`, and bringing your own collector/store. Load when attaching observability to a primitive, observing every flow by default, adding a tracing middleware, or collecting an orchestrator turn report.

### [`export-traces/`](./export-traces/SKILL.md)

Send Panoptic traces to an observability backend via pluggable exporters — `consoleExporter` / `fileExporter` (zero-dep) and `otelExporter` (OpenTelemetry GenAI semantic conventions) / `langfuseExporter` (both lazily import their optional-peer SDK). Covers picking an exporter, the `ExporterContract`, the `gen_ai.*` / `warlock.*` attribute mapping, opt-in content capture (`captureContent` / `redactContent` / `fullHistory` to emit the whole `CapturedMessage[]`), the shared `walkSpans` / `toGenAiAttributes` / `totalCostUsd` utilities, and authoring a custom exporter. Load when wiring `collector.use(...)` with an exporter, exporting to OTel / Langfuse / console / a file, capturing prompt/response content onto spans, or writing a custom sink.

### [`query-traces/`](./query-traces/SKILL.md)

Retain traces in a queryable store — in-memory (`createInMemoryTraceStore`) or **cache-backed and restart-durable** (`createCacheTraceStore` over any `@warlock.js/cache` `CacheDriver` / async factory, with a synchronous in-memory read mirror, write-through persistence, `ready()` hydration, `prefix` / `capacity` / `onError`) — and slice them after the fact: `get` / `query` / `aggregate` / `clear` / `size`, the `TraceQuery` filter (id / session / status / time window), the `TraceAggregate` usage + cost + status rollup, `capacity` FIFO eviction, and the pure `sumUsage` / `emptyUsage` / `matchTrace` helpers. Load when querying collected traces, aggregating AI cost/usage per session, listing failed runs, retaining traces in memory, or persisting them across a restart.

### [`use-local-dashboard/`](./use-local-dashboard/SKILL.md)

Run the zero-setup local Panoptic dashboard — a loopback `node:http` server over a trace store served from `ai.config({ panoptic: { dashboard } })`. Covers the redesigned UI (light/dark/system theme, two-pane nested call tree + metadata panel, colour-coded Title-case type labels including the first-class `Team` type, started/ended wall-clock timestamps, arrow-coded `↓in · ↑out · total` tokens, per-node rollup cost, hide-zero rows, Warlock logo), the new dashboard features (client-side search/filter, group-by-session + group-by-prompt + group-by-type, per-type stats panel, cost heatmap, Gantt timeline, errors-only toggle, hash deep-links) and their pure `trace-filter.ts` helpers (`filterTraces` / `groupBySession` / `groupByPrompt` / `rollupCost` / `maxNodeCost` / `heatIntensity` / `tracePromptKey`), the persistent `cache` store wiring, the declarative path (which store it reads, idempotent wiring), the low-level `dashboard(store, options)` building block, `DashboardOptions` (port `4319`, loopback host, `basePath`, `open`, `title`), the `DashboardHandle`, the read-only `/api/traces` / `/api/aggregate` / `/api/traces/:id` JSON API, `createRequestHandler` / `dashboardHtml` for embedding, prompt-version linkage, and the loopback-only security posture. Load when opening a local AI trace viewer in the browser, theming/filtering it, inspecting traces without a backend, persisting them across a restart, or spinning up a dev observability server.
