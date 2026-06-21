---
title: Exporter output
description: A concrete output sample for each @warlock.js/ai-panoptic exporter — the console summary line and span tree, a file JSON-Lines TraceRecord, the gen_ai.* / warlock.* attributes an OTel span carries, and how a trace maps onto Langfuse traces, generations, and spans.
---

Every Panoptic exporter receives the same vendor-neutral `Trace` and translates it into a backend's wire format. This page shows **exactly what lands** for each of the four shipped exporters, so you know what to look for in your logs, your file sink, your OTel collector, and your Langfuse dashboard.

> The shapes below are derived directly from the exporter source. Token counts, durations, and ids are illustrative; the keys, formatting, and structure are real.

## `consoleExporter` — text lines

The console exporter renders each span through `formatSpanLine`, which produces one scannable line:

```
<marker> <type> "<name>" — <duration>ms, <total> tok[, $<cost>][ [<errorType>: <message>]]
```

The status `marker` is plain ASCII (no color, no emoji) so it survives log aggregators and CI:

| Status | Marker |
|---|---|
| `completed` | `ok` |
| `failed` | `ERR` |
| `cancelled` | `cancel` |
| `max-iterations` | `max-iter` |
| `awaiting-input` | `await` |

The cost suffix (`, $0.0094`) is only appended when the span's `usage.cost` breakdown is present — an unpriced run omits it entirely rather than printing a misleading `$0.0000`.

### Default — one summary line per trace

`consoleExporter()` prints a single line for the root span of each completed trace:

```text
ok workflow "checkout" — 2103ms, 1820 tok, $0.0094
```

A failed trace routes to `console.error` and carries the normalized error in brackets:

```text
ERR agent "router" — 880ms, 240 tok [ToolError: upstream 503]
```

### `{ tree: true }` — the full indented span tree

`consoleExporter({ tree: true })` walks the tree depth-first and prints one line per span, indented two spaces per level of depth:

```text
ok agent "router" — 2103ms, 1820 tok, $0.0094
  ok agent "search-agent" — 1240ms, 470 tok, $0.0021
    ok tool "web-search" — 310ms, 0 tok
  ERR tool "fetch-page" — 90ms, 0 tok [HttpError: timeout]
```

Each line is routed independently: a `failed`/`cancelled` span goes to `console.error`, every other span to `console.log` — so a single bad leaf surfaces at error severity without dragging the whole tree onto the error stream.

> `{ streaming: true }` adds the optional `exportSpan` hook, which prints the **same** `formatSpanLine` output (always at `log` level, depth 0) the moment each span finalizes, ahead of the per-trace summary.

## `fileExporter` — JSON-Lines `TraceRecord`

The file exporter appends one JSON record per line. Each record is a `TraceRecord` envelope — `{ type: "trace", exportedAt, trace }` — wrapping the completed `Trace` verbatim:

```json
{"type":"trace","exportedAt":"2026-06-18T10:00:02.150Z","trace":{"traceId":"run-9f2","sessionId":"sess-1","root":{"spanId":"run-9f2","traceId":"run-9f2","sessionId":"sess-1","name":"checkout","type":"workflow","status":"completed","startedAt":"2026-06-18T10:00:00.000Z","endedAt":"2026-06-18T10:00:02.103Z","duration":2103,"usage":{"input":1500,"output":320,"total":1820,"cost":{"input":0.0045,"output":0.0049}},"children":[{"spanId":"run-9f3","parentSpanId":"run-9f2","traceId":"run-9f2","name":"router","type":"agent","status":"completed","startedAt":"2026-06-18T10:00:00.010Z","endedAt":"2026-06-18T10:00:01.250Z","duration":1240,"usage":{"input":300,"output":170,"total":470},"attributes":{"agent.model.name":"gpt-4o","agent.model.provider":"openai","agent.trips":2},"children":[]}]},"startedAt":"2026-06-18T10:00:00.000Z","endedAt":"2026-06-18T10:00:02.103Z","duration":2103,"usage":{"input":1500,"output":320,"total":1820,"cost":{"input":0.0045,"output":0.0049}}}}
```

The same record, shown indented for readability (this is what `{ pretty: true }` writes, except pretty mode keeps each record across multiple physical lines):

```json
{
  "type": "trace",
  "exportedAt": "2026-06-18T10:00:02.150Z",
  "trace": {
    "traceId": "run-9f2",
    "sessionId": "sess-1",
    "root": {
      "spanId": "run-9f2",
      "traceId": "run-9f2",
      "sessionId": "sess-1",
      "name": "checkout",
      "type": "workflow",
      "status": "completed",
      "startedAt": "2026-06-18T10:00:00.000Z",
      "endedAt": "2026-06-18T10:00:02.103Z",
      "duration": 2103,
      "usage": {
        "input": 1500,
        "output": 320,
        "total": 1820,
        "cost": { "input": 0.0045, "output": 0.0049 }
      },
      "children": [
        {
          "spanId": "run-9f3",
          "parentSpanId": "run-9f2",
          "traceId": "run-9f2",
          "name": "router",
          "type": "agent",
          "status": "completed",
          "startedAt": "2026-06-18T10:00:00.010Z",
          "endedAt": "2026-06-18T10:00:01.250Z",
          "duration": 1240,
          "usage": { "input": 300, "output": 170, "total": 470 },
          "attributes": {
            "agent.model.name": "gpt-4o",
            "agent.model.provider": "openai",
            "agent.trips": 2
          },
          "children": []
        }
      ]
    },
    "startedAt": "2026-06-18T10:00:00.000Z",
    "endedAt": "2026-06-18T10:00:02.103Z",
    "duration": 2103,
    "usage": {
      "input": 1500,
      "output": 320,
      "total": 1820,
      "cost": { "input": 0.0045, "output": 0.0049 }
    }
  }
}
```

Notes on the shape:

- `type` is the record discriminator — always `"trace"` today — so a reader can tell record formats apart without inspecting the payload.
- `exportedAt` is the ISO-8601 time the **line** was written (set by the exporter), distinct from the trace's own `startedAt` / `endedAt`.
- `trace` is the `Trace` exactly as produced by the collector: a `root` span plus the trace-wide `traceId` / `sessionId` / timing / `usage` rollups.
- In compact (default) mode every record is a single physical line — valid JSON Lines, one record per line.

## `otelExporter` — `gen_ai.*` / `warlock.*` attributes on an OTel span

Each `TraceSpan` becomes one OpenTelemetry span (start/end times and parent relationship reconstructed, so the emitted tree matches the original). The exporter sets the attribute map produced by `toGenAiAttributes`. For a span like the `router` agent above, the OTel span carries:

```text
span: "router"   (start 2026-06-18T10:00:00.010Z, end 2026-06-18T10:00:01.250Z)
attributes:
  warlock.report.type        = "agent"
  warlock.duration_ms        = 1240
  gen_ai.usage.total_tokens  = 470
  gen_ai.usage.input_tokens  = 300
  gen_ai.usage.output_tokens = 170
  agent.model.name           = "gpt-4o"      (copied verbatim from the span's attributes bag)
  agent.model.provider       = "openai"
  agent.trips                = 2
status: OK
```

What lands, and the rules behind it:

- **Always present:** `warlock.report.type`, `warlock.duration_ms`, `gen_ai.usage.total_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.
- **Conditional:** `warlock.version` (when the span declared a `version`), `gen_ai.conversation.id` (from the span's `sessionId`), `gen_ai.usage.cached_tokens` / `gen_ai.usage.reasoning_tokens` (when the span's `usage` reported them), and `warlock.cost.usd` (the summed USD scalar — omitted entirely when no pricing was attached, never `0`).
- **Never invented:** `gen_ai.system`, `gen_ai.request.model`, and `gen_ai.operation.name` appear only when the span's free-form `attributes` bag already carried that exact key. The exporter's `system` option backfills `gen_ai.system` **only** when the span supplied none — it never overrides one the span did supply.
- **Verbatim passthrough:** every scalar entry of the span's `attributes` bag (`agent.model.name`, `agent.trips`, `workflow.steps`, `supervisor.iterations`, `tool.tripIndex`, …) is copied onto the OTel span; non-scalar values (objects/arrays) are skipped, and an explicit collector attribute wins over a derived one.

### Failures — `ERROR` status plus a recorded exception

A `failed` or `cancelled` span gets OTel `ERROR` status, and the normalized error is also recorded as a span exception:

```text
span: "fetch-page"
status: ERROR  (message: "timeout")
exception recorded:
  name    = "HttpError"
  message = "timeout"
  stack   = "<captured stack, when the source error carried one>"
```

Successful spans get `OK` status and no exception event.

## `langfuseExporter` — trace, generation, span

The Langfuse exporter maps the trace tree onto Langfuse's own object model:

- **The root span becomes a Langfuse trace** — `client.trace({ id, name, sessionId, version, timestamp, metadata })`, where `id` is the span's `traceId`, `timestamp` is the root `startedAt`, and `metadata` is the same `toGenAiAttributes` map (`warlock.report.type`, `gen_ai.usage.*`, …).
- **A token-producing span (`usage.total > 0`) becomes a `generation`** — created with `parent.generation(...)` and carrying a Langfuse `usage` block `{ input, output, total, unit: "TOKENS" }`.
- **A pure tool/callback span (`usage.total === 0`) becomes a plain `span`** — created with `parent.span(...)`, with **no** `usage` block.
- **Children nest under their parent observation** — a generation's or span's children are created via that observation's own `.generation(...)` / `.span(...)`, preserving the execution tree.
- **Status maps to a level** — `failed`/`cancelled` spans become level `ERROR` with the error message as `statusMessage`; everything else is level `DEFAULT`.

For the `checkout` workflow above, the emitted Langfuse objects are:

```text
trace  "checkout"        id=run-9f2  sessionId=sess-1
  └─ generation "router"        usage={ input:300, output:170, total:470, unit:"TOKENS" }  level=DEFAULT
       └─ generation "search-agent"  usage={ input:180, output:90, total:270, unit:"TOKENS" }  level=DEFAULT
            └─ span "web-search"     (no usage — total is 0)                          level=DEFAULT
       └─ span "fetch-page"          (no usage — total is 0)   statusMessage="timeout"  level=ERROR
```

Each observation also carries the full `toGenAiAttributes` map as its `metadata`, and `version` (when declared) plus the source `startTime` / `endTime` are mapped 1:1. The exporter's `flush()` / `shutdown()` delegate to the client's `flushAsync()` / `shutdownAsync()` — call `collector.shutdown()` on teardown so buffered observations are actually sent.

## See also

- [`@warlock.js/ai-panoptic`](/v/latest/ai/observability/ai-panoptic) — the package overview and how to wire a collector to exporters.
- The `export-traces` skill — picking an exporter, the optional-peer install rules, and writing a custom exporter against `ExporterContract`.
