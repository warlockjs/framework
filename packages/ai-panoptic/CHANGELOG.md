# Changelog — @warlock.js/ai-panoptic

All notable changes to `@warlock.js/ai-panoptic` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.5.0 - 2026-07-01

### Added

- **Zero-setup local dashboard** — `dashboard(store, options)` serves a loopback-only mini-Langfuse (default `127.0.0.1:4319`) with no Docker and no account: light / dark / system theme, a two-pane drawer (nested call tree / detail), a metadata panel, colour-coded Title-case type labels, arrow-coded token rollups (`↓input · ↑output · total`), per-node rollup cost, and the Warlock logo.
- **Dashboard search / filter / grouping** — client-side free-text search, status / type / session / prompt filter chips, an errors-only toggle, and group-by Session / Prompt / Type with a per-type aggregate-stats panel (count, failure rate, p50 / p95 latency, tokens, cost).
- **Cost heatmap, timeline view, and deep-links** — each node carries a cost-tinted accent; the drawer toggles between the call tree and a Gantt timeline (critical path highlighted); the open trace + span are reflected in the URL hash for shareable views.
- **Prompt-version linkage** — agent spans stamp `agent.promptName` / `agent.promptVersion`; the dashboard filters and groups by the resolved `name@version` key.
- **Cache-backed persistent trace store** — `createCacheTraceStore(cache, options)` persists traces through any `@warlock.js/cache` driver, serves reads from an in-memory mirror, and re-hydrates on `ready()` so traces survive a restart; `ai.config({ panoptic: { cache } })` wires it.
- **Declarative `ai.config({ panoptic })`** — configure panoptic once; it registers on core's observer registry and starts the dashboard. Per-flow `observe` + `observeAll` opt flows into observation.
- **`ContentCaptureOptions.fullHistory`** — capture the agent's complete message history on the span; agent content is emitted as a `[system, user]` chat array; Langfuse gets trace-level `input` / `output`.
- **`onError` hook** — handle isolated exporter failures on `panoptic()` / `createCollector()`.
- **Pure trace-list helpers** exported from the package root (`filterTraces` / `groupBySession` / `groupByPrompt` / `groupByType` / `aggregateByType` / `rollupCost` / …) so your own views mirror the dashboard's rules.

### Changed

- **Title-case status & type labels** across rows, drawer, chips, and group headers (underlying filter keys stay lowercase); `team` is a first-class dashboard type; type chips show only present types; drawer metadata keys are humanized; the group-by toggles became a single `Group` dropdown.

### Fixed

- **Isolated exporter failures no longer fail silently** — a failing exporter still never crashes the run, but now warns once (or calls `onError`).

### Security

- **Dashboard hardening** — bearer-token auth (`authToken`, required when binding off-loopback), a `Host`-header allowlist (DNS-rebinding guard), and security response headers (`nosniff` / `X-Frame-Options: DENY` / locked-down CSP) on every response.
- **Error redaction** — captured error `message` / `stack` are scrubbed of secrets (Bearer tokens, API keys) and a retained `cause` is deep-redacted (auth / cookie headers stripped) before a trace is stored or exported.

## 4.4.0 - 2026-06-21

### Added

- **Opt-in content capture.** `panoptic({ captureContent, redactContent })` copies the agent prompt / response and each tool's args / result onto spans, surfaced by the console (`io`), file, OTel (`gen_ai.prompt` / `gen_ai.completion`), and Langfuse exporters. Off by default; a `ContentRedactor` masks each value.

### Fixed

- **Langfuse token accounting** — generations now meter their own usage (rolled-up minus children) and the root execution is metered, so the trace total no longer double-counts nested spans.

## 4.3.0 - 2026-06-21

Initial release — observability collector + exporters for `@warlock.js/ai`.

### Added

- `panoptic()` — the one-call subscriber factory: builds a collector, registers exporters, and feeds traces via `attach()`, `middleware()`, or `collect()`.
- Exporters — `consoleExporter()`, `fileExporter()` (JSON-Lines), `otelExporter()` (GenAI semantic conventions), and `langfuseExporter()`. `@opentelemetry/*` and `langfuse` are optional peers, lazily imported.
- `createInMemoryTraceStore()` — a queryable in-memory trace store (`query` / `aggregate` by runId, sessionId, status, time window; optional `capacity` FIFO cap) that doubles as an exporter.
- Vendor-neutral trace contracts (`Trace` / `TraceSpan` / `CollectorContract` / `ExporterContract`) derived 1:1 from the core `BaseReport` tree, plus skills for observing, exporting, and querying traces.

### Fixed

- **Failed root runs now carry their error in every export** (threaded from the result envelope onto the root span).
- **Per-span exporters now receive every span** (the collector walks the finalized tree).
- **`panoptic().middleware()` now works on a supervisor** (the middleware declares a `supervisor` hook map).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
