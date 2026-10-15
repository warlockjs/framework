# @warlock.js/ai-panoptic

Observability collector + exporters for [`@warlock.js/ai`](../ai).

Panoptic turns the execution reports that every `@warlock.js/ai`
primitive already produces (the `BaseReport` tree from a `.execute()` /
`.invoke()` call) into vendor-neutral traces, then fans them out to
observability backends — OpenTelemetry, Langfuse, or a custom sink.

```bash
npm install @warlock.js/ai @warlock.js/ai-panoptic
# plus whichever backend SDK you export to (all OPTIONAL peers):
npm install @opentelemetry/api @opentelemetry/sdk-trace-base   # OTel
npm install langfuse                                           # Langfuse
```

> The backend SDKs are **optional peer dependencies**. They are lazily
> imported inside the exporter that needs them, so installing
> `@warlock.js/ai-panoptic` never pulls in an SDK you don't use.

## Quick start

`panoptic(...)` is the one-call entry point. It builds a collector, registers
your exporters, and hands back a subscriber you can feed three ways — all
converging on the same collector so each run reaches every exporter exactly once.

```ts
import { ai } from "@warlock.js/ai";
import { panoptic, consoleExporter, otelExporter } from "@warlock.js/ai-panoptic";

const observe = panoptic({
  exporters: [consoleExporter({ tree: true }), otelExporter({ tracerName: "my-app" })],
});

// 1) Attach to an agent/workflow/supervisor event stream — every run is captured.
const agent = ai.agent({ model });
const detach = observe.attach(agent);

await agent.execute("Summarize this");

// ...later, on teardown:
detach();
await observe.shutdown();
```

```ts
// 2) Or wire it through the agent middleware pipeline:
const agent = ai.agent({ model, middleware: [observe.middleware()] });

// 3) Or feed a report directly (the orchestrator turn carries no result event):
const result = await orchestrator.execute(input, { sessionId });
await observe.collect(result.report);
```

By default `attach` subscribes to `agent.completed` / `workflow.completed` /
`supervisor.completed` — the terminal events that fire once per run (completed,
failed, or cancelled) carrying the finalized report. An observability fault is
fully isolated: a throwing exporter never crashes or blocks the AI run. See
[`skills/observe-with-panoptic`](./skills/observe-with-panoptic/SKILL.md) for the
three feed paths in depth, `completedEvents` overrides, and bring-your-own
collector/store wiring.

## Concepts

- **Collector** (`CollectorContract`) — the source end. Ingests a core
  `BaseReport` tree, projects it into a `Trace`, and dispatches that
  trace to every registered exporter. Wire it into your agents via the
  `onComplete` report hook.
- **Trace / TraceSpan** (`Trace`, `TraceSpan`) — the vendor-neutral
  projection of a `BaseReport`. A `TraceSpan` mirrors one execution node
  (identity, timing, status, rolled-up `usage`, error) in the span
  vocabulary shared across observability backends.
- **Exporter** (`ExporterContract`) — the sink end. Translates traces
  into a backend's wire format (`export` per trace, optional
  `exportSpan` for live streaming, `flush` / `shutdown` for draining).

## Exporters

Four exporters ship today, each a factory returning an `ExporterContract`:

```ts
import {
  consoleExporter, // zero-dep — print trace summary or full span tree
  fileExporter,    // zero-dep — append traces as JSON Lines, buffered
  otelExporter,    // OpenTelemetry — gen_ai.* semantic conventions (lazy @opentelemetry/api)
  langfuseExporter, // Langfuse — traces + generations (lazy langfuse)
} from "@warlock.js/ai-panoptic";

collector
  .use(consoleExporter({ tree: true }))
  .use(fileExporter({ path: "storage/traces.jsonl" }))
  .use(otelExporter({ tracerName: "my-app", system: "openai" }))
  .use(langfuseExporter({ publicKey: "pk-...", secretKey: "sk-..." }));
```

`otelExporter` and `langfuseExporter` lazily import their SDK, so it stays
an optional peer — a missing SDK surfaces as a curated "install this"
error on first export, never a boot-time stack trace. See
[`skills/export-traces`](./skills/export-traces/SKILL.md) for the full
mapping (GenAI attribute keys, generation-vs-span rules) and how to write
a custom exporter.

## Tests

```bash
npm test
```

## License

MIT
