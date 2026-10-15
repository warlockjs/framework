---
description: "Observability for @warlock.js/ai: turns agent, workflow and team run reports into traces and ships them to OpenTelemetry, Langfuse, file, console or a local dashboard. Exports `panoptic`, `createCollector`, `createInMemoryTraceStore`, `otelExporter`, `langfuseExporter`, `consoleExporter`, `fileExporter`, `dashboard`. Use for: trace an agent run, see token cost and latency per span, send traces to Langfuse or OTel, query past traces, open a local trace viewer, evaluate a system prompt. Not this package: plain logging → @warlock.js/logger; building agents → @warlock.js/ai; provider adapters → ai-<provider> packages."
---
# @warlock.js/ai-panoptic

Panoptic subscribes to the execution reports every `@warlock.js/ai` primitive already produces, normalizes them into vendor-neutral traces (a trace holds spans with usage, cost and errors), stores them, and fans them out to exporters. Backend SDKs are optional peers, lazily imported.

## The 80% path
1. Call `panoptic(...)` with exporters and attach it to a run or globally (`observe-with-panoptic.md`).
2. Pick sinks (`export-traces.md`); start with console or file locally.
3. Query stored traces (`query-traces.md`).
4. Browse them with zero setup (`use-local-dashboard.md`), and grade a captured system prompt from there (`evaluate-system-prompt.md`).

## Conventions and pitfalls
- Importing the package activates `ai.config({ panoptic })`; a bare import is enough for declarative setup.
- Each run reaches every exporter once, however it is fed; do not register the same collector twice.
- Prompt and response content capture can hold sensitive data: use the content-capture and redactor options before exporting.
- The in-memory store is lost on restart and unbounded unless you set `capacity`; use the cache-backed store or an exporter for durability.
- `@opentelemetry/*` and `langfuse` are optional; install only the one you export to.
