# Changelog — @warlock.js/ai-panoptic

All notable changes to `@warlock.js/ai-panoptic` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.4.0 - 2026-06-21

### Added

- **Opt-in content capture.** `createCollector` / `panoptic({ captureContent, redactContent })` copies the agent prompt/response (first-trip input, last non-empty trip output) and each tool's args/result onto `TraceSpan.input` / `output`. Surfaced by `consoleExporter({ io, ioMaxChars })` (new `in:` / `out:` lines), the file exporter's JSON, OTel `gen_ai.prompt` / `gen_ai.completion`, and Langfuse native `input` / `output`. Off by default — payloads are large and often sensitive; a `ContentRedactor` masks each value. New exports: `ContentCaptureOptions`, `ContentRedactor`, `formatSpanIO`.

### Fixed

- **Langfuse token accounting.** Generations now meter their OWN usage (rolled-up minus children); composite nodes with no own tokens emit as plain spans; the root execution is now emitted as an observation (its own tokens were previously unmetered); and the rolled-up usage/cost is stripped from observation metadata (the `usage` block is authoritative). Together these stop the trace total from double-counting nested spans.

## 4.3.0 - 2026-06-21

Initial release — observability collector + exporters for `@warlock.js/ai`.

### Added

- `panoptic()` — the one-call subscriber factory. Builds a collector, registers exporters, and feeds traces three ways: `attach()` to an agent/workflow/supervisor `*.completed` event stream, `middleware()` for the agent pipeline, and `collect()` for a report directly (e.g. an orchestrator turn). Plus `use()`, `toTrace()`, `flush()`, `shutdown()`, and a `collector` accessor.
- `createPanopticMiddleware()` — the underlying `AgentMiddleware` adapter feeding the collector from the `execute.after` / `execute.onError` hooks
- `Panoptic` / `PanopticOptions` / `PanopticTarget` / `CompletedEventPayload` types
- `panoptic` + middleware + types exported from the root barrel
- `scripts/generate-llms.mjs` and the generated `llms.txt` / `llms-full.txt` projections of `skills/`
- `skills/observe-with-panoptic/SKILL.md` — wiring the subscriber into a run
- `consoleExporter()` — zero-dep exporter printing trace summary or full span tree
- `fileExporter()` — zero-dep buffered JSON-Lines exporter with `flushEvery`
- `otelExporter()` — OpenTelemetry exporter mapping spans to GenAI semantic conventions (`gen_ai.*`)
- `langfuseExporter()` — Langfuse exporter mapping spans to traces, generations, and spans
- `toGenAiAttributes()` / `walkSpans()` / `totalCostUsd()` exporter utilities
- Optional peers `@opentelemetry/api` and `langfuse` are lazily imported by their exporters
- `createCollector()` — consumes the core `BaseReport` tree, projects it to a `Trace`, fans out to exporters
- `reportToTrace()` / `reportToSpan()` pure projections of a report node to spans
- `createInMemoryTraceStore()` — queryable in-memory store, doubles as an `ExporterContract`
- `TraceStoreContract` with `query` / `aggregate` by runId, sessionId, status, and time window
- `TraceQuery` and `TraceAggregate` types for slicing and rolling up usage + cost
- `sumUsage()` usage + cost rollup across stored traces, backed by core `accumulateCost`
- optional `capacity` cap on the in-memory store with FIFO eviction
- contract surface: `CollectorContract`, `ExporterContract`, and the vendor-neutral trace types `Trace` / `TraceSpan` / `TraceSpanError`, derived 1:1 from the core `BaseReport` tree and event stream
- `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, and `langfuse` declared as OPTIONAL peer dependencies (lazily imported by the exporters that need them)
- `skills/query-traces/SKILL.md` — dedicated skill for the in-memory queryable trace store (`createInMemoryTraceStore`, `query` / `aggregate`, `TraceQuery` / `TraceAggregate`, `capacity` FIFO eviction, `sumUsage` / `emptyUsage` / `matchTrace` helpers)

### Changed

- `skills/export-traces/SKILL.md` — OTel attribute notes: `gen_ai.system` / `gen_ai.request.model` / `gen_ai.operation.name` are only forwarded when the span's attribute bag carried them (`system` backfilled from options), never invented

### Fixed

- **Failed root runs now carry their error in every export** — `collect()` / `reportToTrace()` / `attach()` / `middleware()` thread the result-envelope error (`BaseResult.error`) onto the root span (which `BaseReport` doesn't carry); `collect()` / `reportToTrace()` gained an optional `rootError` parameter
- **Per-span exporters now receive every span** — the collector's `dispatch` walks the finalized tree (`walkSpans`), invoking `exportSpan` once per node (a post-completion per-span projection, not live streaming)
- **`panoptic().middleware()` now works on a supervisor** — the middleware declares a `supervisor` hook map (not only `execute`), so `ai.supervisor({ middleware: [observe.middleware()] })` collects a trace
- `totalCostUsd()` folds in `cost.reasoning`; the Langfuse exporter `end()`s every observation; the OTel exporter maps `max-iterations` / `awaiting-input` to `UNSET` (a hit cap no longer reads as clean success)
