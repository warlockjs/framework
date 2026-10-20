---
description: 'AI tracing, usage, cost analysis and dashboards: `panoptic`, `createCollector`, `createInMemoryTraceStore`, `consoleExporter`, `otelExporter`, `langfuseExporter` and `dashboard`. Use for "trace an agent run", "compare prompt costs", "export spans" or "inspect the AI dashboard". Not this package → @warlock.js/ai for running agents and evals; @warlock.js/logger for logs; @warlock.js/devtools for HTTP debugging.'
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
