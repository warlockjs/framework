---
title: What Panoptic traces
description: The Trace and TraceSpan model — how Panoptic projects a core report tree into spans, the span tree you get for agents, workflows, supervisors, and orchestrators, and the full gen_ai.* / warlock.* attribute catalog.
sidebar:
  order: 2
  label: "What Panoptic traces"
---

Panoptic does not instrument your code. It **projects** the report tree `@warlock.js/ai` already produces on every run. A `Trace` is a 1:1 projection of that tree into the span vocabulary shared by OpenTelemetry, Langfuse, and similar backends — nothing is sampled, summarized, or re-derived. If a node exists in `result.report`, it exists in the trace; if it doesn't, Panoptic never invents it.

This page describes the **model**: what a `Trace` and a `TraceSpan` are, the span tree you get for each primitive, and the complete attribute catalog.

## The model: `Trace` and `TraceSpan`

Every executable primitive returns a `BaseReport` tree. Each node carries identity, timing, status, a rolled-up `usage`, and its `children` in invocation order. Panoptic's collector walks that tree once and maps each node to a `TraceSpan`:

| `BaseReport` field | `TraceSpan` field | Notes |
| --- | --- | --- |
| `runId` | `spanId` | one span per execution node |
| `parentRunId` | `parentSpanId` | absent on the root span |
| `rootRunId` | `traceId` | equals `spanId` on the root |
| `sessionId` | `sessionId` | absent when the caller supplied none |
| `name` | `name` | tool / agent / workflow / supervisor name |
| `version` | `version` | dev-curated, free-form, absent when undeclared |
| `type` | `type` | the `ReportType` discriminator (`agent` / `workflow` / `supervisor` / `team` / `planner` / `orchestrator` / `tool`; `team` is its own first-class member, distinct from `supervisor`) |
| `status` | `status` | `completed` / `failed` / `cancelled` / `max-iterations` / `awaiting-input` |
| `startedAt` / `endedAt` / `duration` | same | ISO-8601 timestamps + ms duration |
| `usage` | `usage` | this node's own cost **plus** the sum of its children |
| `error` | `error` | normalized to the JSON-safe `TraceSpanError` shape |
| `children` | `children` | recursed in invocation order |

Primitive-specific detail that has no first-class span field — trip counts, step counts, the model an agent ran against, a tool's originating trip index — is routed into the optional `attributes` bag (the [attribute catalog](#attribute-catalog) below). Only populated keys are emitted; an empty bag stays absent.

The mapping is **lossless on the fields exporters care about** — identity, timing, outcome, cost — so the collector flattens a report into spans without consulting any other source. One outermost `BaseReport` (a single `.execute()` / `.invoke()` call) becomes one `Trace`:

```ts
type Trace = {
  traceId: string;            // = root span's traceId / rootRunId
  sessionId?: string;         // when the run carried one
  root: TraceSpan;            // the root span — its subtree is the whole run
  startedAt: string;
  endedAt: string;
  duration: number;           // ms
  usage: Usage;               // trace-wide rollup (= root span usage)
  reportSchemaVersion?: number;
};
```

`Trace.usage`, timing, and `traceId` all read off the root span the projection already built, so the trace envelope never disagrees with its own root.

## The span tree per primitive

A trace is one **root span per run**, with child spans for each LLM trip, tool call, workflow step, and supervisor iteration — mirroring `BaseReport.children` exactly. You get a different shape depending on which primitive you ran.

### (a) An agent with tools

The agent is the root. Each tool the agent dispatched is a leaf child span (`type: "tool"`), tagged with the trip it was called on:

```text
agent  "support-agent"
├─ tool   "searchKnowledgeBase"   (tool.tripIndex = 0)
├─ tool   "lookupOrder"           (tool.tripIndex = 0)
└─ tool   "escalateToHuman"       (tool.tripIndex = 1)
```

The agent span carries `agent.trips`, `agent.model.name`, and `agent.model.provider`. Tools contribute zero own-cost; the LLM spend lives on the agent span's `usage`.

### (b) A workflow

The workflow is the root; each step it ran nests beneath it. A step that is itself an agent expands into its own agent-plus-tools subtree:

```text
workflow  "onboarding"
├─ agent     "classify-intent"
│  └─ tool      "fetchUserProfile"   (tool.tripIndex = 0)
├─ agent     "draft-reply"
└─ tool      "sendEmail"             (tool.tripIndex = 0)
```

The workflow span carries `workflow.steps` (the step count), and `workflow.name` / `workflow.signature` when present.

### (c) A supervisor

The supervisor is the root; each delegated agent run is a child span. Iterations are reported on the supervisor span as a count, not as separate nesting levels:

```text
supervisor  "research-lead"   (supervisor.iterations = 3, supervisor.terminatedBy = "tool")
├─ agent       "researcher"
│  └─ tool        "webSearch"   (tool.tripIndex = 0)
├─ agent       "researcher"
└─ agent       "summarizer"
```

The supervisor span carries `supervisor.iterations` and `supervisor.terminatedBy` (and `supervisor.name` when present).

### (d) An orchestrator turn — collected via `collect()`

The orchestrator's `orchestrator.turn.*` events carry only session identity, not a result-bearing report, so it is **not** covered by `attach()`. Feed the turn report in directly with `observe.collect(result.report)`. The orchestrator is the root; the primitive it routed the turn to nests beneath it:

```ts
const result = await orchestrator.execute(input, { sessionId });
await observe.collect(result.report);
```

```text
orchestrator  "concierge"   (orchestrator.turnIndex = 4, orchestrator.turns = 1)
└─ agent         "billing-agent"
   ├─ tool          "getInvoice"     (tool.tripIndex = 0)
   └─ tool          "issueRefund"    (tool.tripIndex = 1)
```

The orchestrator span carries `orchestrator.turnIndex`, `orchestrator.turns`, and `orchestrator.signature` when present.

## Attribute catalog

Two namespaces of attributes ride on each span. The token counts come from the span's typed `usage` rollup; everything else is forwarded from the collector's free-form `attributes` bag. `toGenAiAttributes(span)` folds both into a single flat map ready for an OTel span or a Langfuse generation.

### `gen_ai.*` — OpenTelemetry GenAI semantic conventions

| Attribute | Source |
| --- | --- |
| `gen_ai.usage.input_tokens` | `span.usage.input` |
| `gen_ai.usage.output_tokens` | `span.usage.output` |
| `gen_ai.usage.total_tokens` | `span.usage.total` |
| `gen_ai.usage.cached_tokens` | `span.usage.cachedTokens` (when reported) |
| `gen_ai.usage.reasoning_tokens` | `span.usage.reasoningTokens` (when reported) |
| `gen_ai.conversation.id` | `span.sessionId` (when present) |
| `gen_ai.system` | forwarded from the bag; **never invented** — `otelExporter`'s `system` option can backfill it when the span supplied none |
| `gen_ai.request.model` | forwarded from the bag — **never invented** |
| `gen_ai.operation.name` | forwarded from the bag — **never invented** |

The token keys are emitted under their `gen_ai.usage.*` convention names regardless of which internal constant table (`GEN_AI_ATTRIBUTES` or `WARLOCK_ATTRIBUTES`) defines them. `gen_ai.system` / `gen_ai.request.model` / `gen_ai.operation.name` appear **only** when the span's `attributes` bag already carried that exact key — Panoptic never fabricates a model name or operation it didn't observe.

### `warlock.*` — Panoptic-specific keys

Namespaced under `warlock.*` so they never collide with a future `gen_ai.*` key:

| Attribute | Source |
| --- | --- |
| `warlock.report.type` | `span.type` |
| `warlock.version` | `span.version` (when declared) |
| `warlock.duration_ms` | `span.duration` |
| `warlock.cost.usd` | `totalCostUsd(span.usage)` — a single USD scalar, omitted when no pricing was attached |

### Per-primitive keys

The collector populates the `attributes` bag with detail specific to each primitive. Every scalar entry rides along verbatim onto the backend span:

| Key | On span type | Meaning |
| --- | --- | --- |
| `agent.model.name` | `agent` | model the agent ran against |
| `agent.model.provider` | `agent` | provider of that model |
| `agent.trips` | `agent` | number of LLM round-trips |
| `workflow.name` | `workflow` | workflow identity (when present) |
| `workflow.signature` | `workflow` | workflow signature (when present) |
| `workflow.steps` | `workflow` | number of steps |
| `supervisor.name` | `supervisor` | supervisor identity (when present) |
| `supervisor.iterations` | `supervisor` | iteration count |
| `supervisor.terminatedBy` | `supervisor` | what ended the loop |
| `orchestrator.turnIndex` | `orchestrator` | which turn this report is |
| `orchestrator.signature` | `orchestrator` | orchestrator signature (when present) |
| `orchestrator.turns` | `orchestrator` | number of turns in the report |
| `tool.tripIndex` | `tool` | the agent trip that dispatched the tool |
| `tool.recoveredFrom` | `tool` | recovery origin (when present) |
| `retries` | any | retry count, from `BaseReport.attempts` |

### Lineage

Every span carries the identity needed to reconstruct the tree without re-walking `children` — and to slice flat trace tables back into per-run and per-session groupings:

| Field | Mirrors | Role |
| --- | --- | --- |
| `traceId` | `rootRunId` | top-level trace this span belongs to; equals `spanId` on the root |
| `parentSpanId` | `parentRunId` | immediate parent; absent on the root |
| `spanId` | `runId` | this node's stable id |
| `sessionId` | `sessionId` | caller-supplied conversation/request grouping |

## An annotated span tree

Putting the model together — an agent with two tools, exported as the console tree (`consoleExporter({ tree: true })`) with the attributes each span carries annotated alongside:

```text
ok agent "support-agent" — 1840ms, 1320 tok, $0.0094
│   ├─ spanId       = 7f3a…            (mirrors report.runId)
│   ├─ traceId      = 7f3a…            (= rootRunId; equals spanId on the root)
│   ├─ sessionId    = session-42       → gen_ai.conversation.id
│   ├─ warlock.report.type   = "agent"
│   ├─ warlock.duration_ms   = 1840
│   ├─ warlock.cost.usd      = 0.0094
│   ├─ gen_ai.usage.input_tokens  = 910
│   ├─ gen_ai.usage.output_tokens = 410
│   ├─ gen_ai.usage.total_tokens  = 1320
│   ├─ agent.trips           = 2
│   ├─ agent.model.name      = "gpt-4o"
│   └─ agent.model.provider  = "openai"
│
├─ ok tool "lookupOrder" — 32ms, 0 tok
│      ├─ parentSpanId  = 7f3a…        (mirrors parentRunId → the agent)
│      ├─ traceId       = 7f3a…        (same trace as the root)
│      ├─ warlock.report.type = "tool"
│      └─ tool.tripIndex      = 0       (dispatched on the agent's first trip)
│
└─ ok tool "escalateToHuman" — 11ms, 0 tok
       ├─ parentSpanId  = 7f3a…
       ├─ warlock.report.type = "tool"
       └─ tool.tripIndex      = 1       (dispatched on the second trip)
```

The tool spans report `0 tok` and no cost because all LLM spend rolls up onto the agent span — exactly as it does on the source `BaseReport`. The `traceId` is shared by every span; `parentSpanId` reconstructs the nesting; `tool.tripIndex` ties each tool back to the agent trip that called it.

## Capturing content — `input` / `output`

By default a span carries identity, timing, status, cost, and attributes — but **not** the prompt, the completion, or the tool payloads. Those are large and frequently sensitive, so they stay absent. Opt in with `captureContent` (on the collector via `createCollector(...)`, or on the subscriber via `panoptic({ captureContent: true })`) to copy raw content onto `span.input` / `span.output`, where every exporter can surface it — `consoleExporter({ io: true })`, the file exporter's JSON, OTel `gen_ai.prompt` / `gen_ai.completion`, and Langfuse `input` / `output`:

```ts
const observe = panoptic({
  exporters: [consoleExporter({ io: true })],
  captureContent: true,
});
```

What lands per primitive:

- **Tools** — the call arguments on `input`, the return value on `output` (read straight off the tool report).
- **Agents** — the first-trip prompt as a `[system, user]` chat array (or the bare user string when there's no system prompt) on `input`, and the **last non-empty trip output** (the final response text — a failed / max-trips run can end on an empty trip, so Panoptic scans back for the last one that carried text) on `output`.

A `ContentRedactor` masks each value before it's stored — return a masked value to keep it, or `undefined` to drop the field entirely:

```ts
const observe = panoptic({
  exporters: [consoleExporter({ io: true })],
  captureContent: true,
  redactContent: (value, { field }) =>
    field === "input" ? "[redacted prompt]" : value,
});
```

### `fullHistory` — the complete conversation on `span.input`

`captureContent` emits only the **first trip's** `[system, user]` prompt. For a multi-trip tool-using agent, that omits the tool results and follow-up turns the model actually saw. Set `fullHistory: true` to emit the agent's **complete `CapturedMessage[]`** — every trip, every role (system, user, assistant tool-calls, tool results, the final assistant message) — onto `span.input` instead:

```ts
const observe = panoptic({
  exporters: [langfuseExporter({ publicKey, secretKey })],
  captureContent: true,
  fullHistory: true, // emit the whole assembled conversation
});
```

`span.output` is unchanged — it stays the agent's last non-empty trip output (the final response text). Only `span.input` swaps from the first-trip array to the full message log.

**It requires the agent to capture its messages.** `fullHistory` reads the report's `messages` array, which a core `@warlock.js/ai` agent only populates when its own `captureMessages` option is set:

```ts
const agent = ai.agent({
  model,
  captureMessages: true, // core must record the conversation for fullHistory to have anything to emit
});
```

When the agent **didn't** opt into `captureMessages` (so the report has no `messages`, or an empty one), `fullHistory` **falls back gracefully** to the standard first-trip `[system, user]` capture — it never errors, it just degrades to today's behavior. So a run that didn't opt in is unaffected, and a mix of opted-in and opted-out agents under one collector each capture as much as they recorded.

Other `fullHistory` behaviors worth knowing:

- **Off without `captureContent`.** `fullHistory` only matters when `captureContent` is on. With `captureContent` off, no content is captured regardless of `fullHistory`.
- **The redactor sees the whole array as one value.** Under `fullHistory`, the `ContentRedactor` is called once with the entire `CapturedMessage[]` (not per message) on the `input` field — mask or reshape the array as a unit, or return `undefined` to drop `input` entirely.
- **Tools are unaffected.** `fullHistory` is an agent-input concern; tool spans still capture their args/result exactly as under plain `captureContent`.

> Capturing full conversations means raw prompts, tool payloads, and completions ride along on every span and into every exporter. Pair `fullHistory` with a `redactContent` masker in any environment where that content is sensitive, and keep the [local dashboard](./local-dashboard) loopback-only.

## Related

- [@warlock.js/ai-panoptic](./ai-panoptic) — the package overview, `panoptic()` entry point, and exporters.
- [Configuring Panoptic](./configuring-panoptic) — wire content capture declaratively via `ai.config({ panoptic })`.
- [The local dashboard](./local-dashboard) — inspect captured content in a loopback-only UI.
