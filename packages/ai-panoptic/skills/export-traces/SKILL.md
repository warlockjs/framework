---
name: export-traces
description: 'Send @warlock.js/ai-panoptic traces to an observability backend via pluggable exporters, including capturing prompt/response content onto spans. Triggers: `consoleExporter`, `fileExporter`, `otelExporter`, `langfuseExporter`, `ExporterContract`, `ContentCaptureOptions`, `captureContent`, `redactContent`, `fullHistory`, `ContentRedactor`, `toGenAiAttributes`, `walkSpans`, `totalCostUsd`, `GEN_AI_ATTRIBUTES`, `WARLOCK_ATTRIBUTES`, `reportToTrace`, `reportToSpan`, `extractSpanAttributes`, `normalizeError`, `formatSpanLine`, `createPanopticMiddleware`; ''export AI traces to OpenTelemetry'', ''send traces to Langfuse'', ''log traces to console / a file'', ''capture the full prompt/conversation onto a span'', ''gen_ai semantic conventions'', ''write a custom exporter''; typical import `import { otelExporter, langfuseExporter, consoleExporter, fileExporter } from "@warlock.js/ai-panoptic"`. Skip: wiring the subscriber/collector into a run — `@warlock.js/ai-panoptic/observe-with-panoptic/SKILL.md`; the core report shape — `@warlock.js/ai/run-ai-agent/SKILL.md`.'
---

# Export traces — the sink end of Panoptic

An **exporter** translates a vendor-neutral `Trace` (produced by the collector) into a backend's wire format. The collector fans every completed trace out to each registered exporter via the `ExporterContract`:

```ts
export interface ExporterContract {
  readonly name: string;
  export(trace: Trace): void | Promise<void>;
  exportSpan?(span: TraceSpan): void | Promise<void>; // optional live streaming
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}
```

Four exporters ship today. Each is a **factory** returning an `ExporterContract` — callers never `new`.

## Pick an exporter

| Exporter | Backend | Deps | Use it for |
|---|---|---|---|
| `consoleExporter()` | stdout/stderr | none | local dev, CI logs |
| `fileExporter()` | JSON-Lines file | none | durable local sink, replay, out-of-band shipping |
| `otelExporter()` | OpenTelemetry | `@opentelemetry/api` (optional peer) | OTel-native stacks, GenAI semantic conventions |
| `langfuseExporter()` | Langfuse | `langfuse` (optional peer) | LLM-specific dashboards, generations |

> `@opentelemetry/api` and `langfuse` are **OPTIONAL peer dependencies**, lazily imported by their exporter. Importing `@warlock.js/ai-panoptic` never pulls them in; a missing SDK surfaces as a curated *"install this"* error on first export, never a boot-time stack trace.

## Console

```ts
import { consoleExporter } from "@warlock.js/ai-panoptic";

collector.use(consoleExporter());                 // one summary line per trace
collector.use(consoleExporter({ tree: true }));   // full indented span tree
collector.use(consoleExporter({ streaming: true })); // also print each span as it finalizes
```

Failed/cancelled spans route to `console.error`; everything else to `console.log`. Inject a sink (`{ console: mySink }`) to redirect or to capture in tests.

## File

```ts
import { fileExporter } from "@warlock.js/ai-panoptic";

collector.use(fileExporter({ path: "storage/traces.jsonl" }));      // write every trace
collector.use(fileExporter({ path: "...", flushEvery: 50 }));       // batch 50 traces per write
collector.use(fileExporter({ path: "...", pretty: true }));         // multi-line records
```

Appends one JSON record per line (a `TraceRecord` = `{ type: "trace", exportedAt, trace }`). Buffers in memory and drains on `flush()` / `shutdown()` — call `collector.shutdown()` on teardown so the last batch lands. The parent directory is created on first write.

## OpenTelemetry

The exporter emits spans onto a `Tracer`; **the host app owns the SDK wiring** (`TracerProvider`, processors, span exporters), exactly as with any OTel instrumentation.

```ts
import { otelExporter } from "@warlock.js/ai-panoptic";

// app already configured @opentelemetry/sdk-trace-base + a global provider
collector.use(otelExporter({ tracerName: "my-app", system: "openai" }));

// or pass a Tracer directly
collector.use(otelExporter({ tracer: myTracer }));
```

Each `TraceSpan` becomes one OTel span with the source start/end times and parent relationship reconstructed, so the emitted tree matches the original execution tree. Attributes follow the [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

- `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.usage.total_tokens` (from the span's typed `usage` rollup)
- `gen_ai.usage.cached_tokens` / `gen_ai.usage.reasoning_tokens` (when the span reported them)
- `gen_ai.conversation.id` (from the span's `sessionId`)
- `gen_ai.system` / `gen_ai.request.model` / `gen_ai.operation.name` — **never invented**: these appear only when the span's free-form `attributes` bag already carried that exact key. `otelExporter`'s `system` option backfills `gen_ai.system` when the span supplied none (and never overrides one it did).
- `warlock.report.type` / `warlock.version` / `warlock.duration_ms` / `warlock.cost.usd`
- the collector's own per-primitive keys ride along verbatim — `agent.model.name` / `agent.model.provider` / `agent.trips`, `workflow.steps`, `supervisor.iterations` / `supervisor.terminatedBy`, `tool.tripIndex`, `retries`, … — since `toGenAiAttributes` copies every scalar entry of the span's `attributes` bag.

Failed/cancelled spans get OTel `ERROR` status plus a recorded exception.

## Langfuse

```ts
import { langfuseExporter } from "@warlock.js/ai-panoptic";

collector.use(langfuseExporter({ publicKey: "pk-...", secretKey: "sk-...", baseUrl: "..." }));
// or reuse an existing Langfuse client
collector.use(langfuseExporter({ client: myLangfuse }));
```

- The root span becomes a Langfuse **trace**.
- A token-producing span (`usage.total > 0`) becomes a **generation** (carries `usage`); a pure tool/callback becomes a plain **span**.
- Children nest under their parent observation; timing, `version`, and status (failed → `ERROR` level) are mapped.
- `flush()` / `shutdown()` delegate to the client's `flushAsync()` / `shutdownAsync()` — call `collector.shutdown()` on teardown so buffered observations are sent.

## Content capture — what reaches the `input` / `output` fields

Exporters surface `span.input` / `span.output` (console `in:` / `out:`, file JSON, OTel `gen_ai.prompt` / `gen_ai.completion`, Langfuse native `input` / `output`) only when **content capture** is enabled on the collector or subscriber. It's `ContentCaptureOptions`, set on `createCollector(...)` or `panoptic(...)`:

```ts
panoptic({
  exporters: [langfuseExporter({ /* ... */ })],
  captureContent: true,                 // copy prompts/responses + tool args/results onto spans
  redactContent: (value, { field }) =>  // optional masker, per value
    field === "input" ? "[redacted]" : value,
  fullHistory: true,                    // emit the WHOLE conversation as span.input (see below)
});
```

Off by default — payloads are large and frequently sensitive. With `captureContent`, an agent span's `input` is a `[system, user]` chat array (or the bare user string when there's no system prompt) and its `output` is the last non-empty trip's text; a tool span carries its call args + result.

### `fullHistory` — emit the entire `CapturedMessage[]`

`fullHistory: true` replaces the `[system, user]` first-trip array on `span.input` with the agent's **complete assembled conversation** — every trip, every role (system / user / assistant / tool). The `output` stays the final response text.

```ts
// upstream: the agent run MUST opt into capturing its messages
const result = await agent.execute(input, { captureMessages: true });
//                                          ^ core @warlock.js/ai — makes report.messages present

panoptic({ exporters: [...], captureContent: true, fullHistory: true });
```

**Requires the upstream `captureMessages`.** `fullHistory` reads `report.messages` (the captured `CapturedMessage[]`). When the run did NOT opt into `captureMessages`, `report.messages` is absent and the branch **degrades gracefully** to today's first-trip `[system, user]` capture — never an error, just less history. The whole array is passed through `ContentRedactor` as a single value, so masking still applies to captured history.

Reach for `fullHistory` when a backend (Langfuse) should show the full multi-turn / tool-loop transcript a run actually sent, not just its opening prompt.

## Shared utilities

Reusable when authoring a **custom exporter**:

```ts
import { walkSpans, toGenAiAttributes, totalCostUsd, GEN_AI_ATTRIBUTES, WARLOCK_ATTRIBUTES } from "@warlock.js/ai-panoptic";

for (const span of walkSpans(trace.root)) {        // depth-first pre-order
  const attributes = toGenAiAttributes(span);      // gen_ai.* / warlock.* attribute map
  const cost = totalCostUsd(span.usage);           // single USD scalar, or undefined
}
```

`toGenAiAttributes` copies only **scalar** entries from a span's free-form `attributes` bag (objects/arrays are skipped — backend attribute values must be primitives) and lets an explicit collector attribute override a derived one.

## Write a custom exporter

Implement `ExporterContract` directly — `name` + `export` are the only required members:

```ts
import type { ExporterContract, Trace } from "@warlock.js/ai-panoptic";

const myExporter: ExporterContract = {
  name: "my-backend",
  async export(trace: Trace) {
    await sendSomewhere(trace);
  },
};

collector.use(myExporter);
```

Wrapping a third-party SDK? Lazily `await import(...)` it **inside** the export path (never at module top) so it stays an optional peer — copy the loader pattern from `otelExporter` / `langfuseExporter`. The collector isolates a throwing exporter, so one backend's failure never crashes the originating AI run.

## Lower-level building blocks

Most apps only need `panoptic(...)`, an exporter, and the store. These lower-level exports exist for **custom collectors / exporters and bespoke pipelines** — each is a pure function over the report tree:

```ts
import {
  reportToTrace, // (report: BaseReport) => Trace — project a finished report into a vendor-neutral Trace
  reportToSpan, // (report: BaseReport) => TraceSpan — project one report node into a span (recurses into children)
  extractSpanAttributes, // (report: BaseReport) => Record<string, unknown> | undefined — the per-primitive attribute bag (agent.model.name, workflow.steps, …)
  normalizeError, // (error: unknown) => TraceSpanError | undefined — coerce any thrown value into the typed span-error shape
  formatSpanLine, // (span: TraceSpan, depth?: number) => string — render one indented console line (consoleExporter's tree mode uses this)
  createPanopticMiddleware, // (collector: CollectorContract, name?: string) => AgentMiddleware — build a middleware from a collector you already hold (panoptic(...) wires this for you)
} from "@warlock.js/ai-panoptic";
```

Reach for `reportToTrace` when you already hold a finished `result.report` and want a `Trace` without the live subscriber; `formatSpanLine` to build a custom console renderer; `createPanopticMiddleware` when you assemble the agent's `middleware` array by hand instead of letting `panoptic(...)` do it.

## See also

- [`@warlock.js/ai-panoptic/observe-with-panoptic/SKILL.md`](@warlock.js/ai-panoptic/observe-with-panoptic/SKILL.md) — the source end: wiring the `panoptic(...)` subscriber into a run (`attach` / `middleware` / `collect`). The `collector` these exporters register on comes from there.
- [`@warlock.js/ai-panoptic/query-traces/SKILL.md`](@warlock.js/ai-panoptic/query-traces/SKILL.md) — the in-memory trace store: a sibling sink that *retains* traces (instead of shipping them out) so you can `query` / `aggregate` them after the fact.
- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md) — running the agent and the `BaseReport` shape Panoptic projects into a `Trace`.
