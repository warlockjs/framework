---
title: "Run agent"
description: The ai.agent() factory in depth — execute, stream, attachments, structured output, repair, cancellation, events.
sidebar:
  order: 1
  label: "Run agent"
---

`ai.agent({...})` is the lowest rung of the ladder. One LLM call, optional tool loop, optional structured output. Stateless across calls.

## The factory

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const myAgent = ai.agent({
  name: "summarizer",                        // optional — anonymous gets a fingerprint
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: "You are concise.",          // string or SystemPromptContract
  tools: [searchTool, calcTool],             // optional
  placeholders: { language: "English" },     // mustache substitution defaults
  maxTrips: 10,                              // tool-loop bound (default 10)
  modelOptions: { temperature: 0.2 },        // forwarded to the model
  output: summarySchema,                     // default structured-output schema
  middleware: [budgetMw, cacheMw],           // optional
  streamingToolGuard: {},                    // opt-in tool-call recovery
  on: { "agent.starting": handler },         // factory-level event handlers
  version: "v3-2026-05",                     // mirrored onto reports
});
```

The factory returns an `AgentContract<TOutput>`. Every execution spawns a fresh internal `Execution` — the factory holds no per-call state.

## Anonymous agents

`name` is optional. Anonymous agents receive a deterministic fingerprint based on provider, model, and tool names:

```text
anon_openai_gpt-4o-mini
anon_openai_gpt-4o-mini_search+calc
```

Same config across process restarts → same synthetic name. This matters when workflows fingerprint their structure for snapshot drift detection — composing the same anonymous agent twice produces the same identifier.

## `agent.execute(input, options)`

The blocking call. Returns a promise of `AgentResult<T>`. Never throws.

```ts
const { data, text, report, usage, error } = await myAgent.execute(input);
```

Every option is optional:

```ts
agent.execute(input, {
  history,             // Message[] — prior turns
  attachments,         // image attachments (strings or tagged objects)
  placeholders,        // override factory placeholders for this call
  output,              // override the structured-output schema for this call
  responseSchema,      // hand-crafted JSON Schema escape hatch
  systemPrompt,        // per-call system-prompt override
  repair,              // { maxAttempts } — re-ask on validation failure
  signal,              // AbortSignal
  sessionId,           // stamped onto every report node
  streamingToolGuard,  // per-call override
  on,                  // per-call event handlers
});
```

Call-site `output` fully **replaces** the factory's `output` for that run — no merging.

## `agent.stream(input, options)`

Same surface, but you get an async iterable of typed events plus a `.result` promise:

```ts
const stream = myAgent.stream(input);

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") {
    process.stdout.write(event.delta);
  }
}

const result = await stream.result;
```

The same lifecycle events fire whether you call `execute` or `stream` — streaming adds per-token deltas on top. The final envelope on `stream.result` is identical to what `execute` would resolve with.

## The result envelope

```ts
type AgentResult<T> = {
  type: "agent";
  data?: T;             // typed structured output when `output` schema was supplied
  text?: string;        // raw final LLM text
  report: AgentReport;
  usage: Usage;         // aggregated tokens + per-channel cost breakdown
  error?: AIError;
};

type AgentReport = {
  status: "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string;
  duration: number;
  model: { name: string; provider: string };
  trips: LLMTrip[];
  toolCalls: ToolCall[];
};
```

`trips` and `toolCalls` are flat lists with timing and outcome on every entry — easy to write reporting on top of.

## Structured output

```ts
import { v, type Infer } from "@warlock.js/seal";

const summarySchema = v.object({
  summary: v.string(),
  keyPoints: v.array(v.string()).min(1),
});

const result = await myAgent.execute(input, { output: summarySchema });

if (result.data) {
  // typed as Infer<typeof summarySchema>
}
```

Bake it into the agent for end-to-end typing:

```ts
const summarizer = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  output: summarySchema,
});

const result = await summarizer.execute(input);
//    ^? AgentResult<{ summary?: string; keyPoints?: string[] }>
```

Adapters with native `capabilities.structuredOutput` forward the schema as JSON Schema. Adapters without it get a soft "respond in JSON only" instruction. Client-side validation always runs.

## Repair on validation failure

```ts
await myAgent.execute(input, {
  output: schema,
  repair: { maxAttempts: 1 },
});
```

Off by default. Each repair attempt counts against `maxTrips`. The framework tells the model what failed so it can correct.

## Image attachments

```ts
await myAgent.execute("What's in this?", {
  attachments: ["./photo.png", "https://cdn.example.com/cat.jpg"],
});
```

Shorthand strings infer the image kind from extension. Tagged form for explicit control:

```ts
attachments: [
  { type: "image", source: "./photo" },
  { type: "image", source: { base64: "...", mediaType: "image/png" } },
];
```

The model must declare `capabilities.vision` or you get a typed error at the boundary. OpenAI adapter auto-infers vision from the model name; override with `openai.model({ name, vision: true })`.

## Cancellation

```ts
const ctrl = new AbortController();
const promise = myAgent.execute(input, { signal: ctrl.signal });

setTimeout(() => ctrl.abort("too slow"), 30_000);

const { error, report } = await promise;

if (report.status === "cancelled") {
  // error is an AgentCancelledError (code "AGENT_CANCELLED")
  // carrying `cancelledAt` + the abort `reason`
}
```

Between-trip abort is guaranteed. Mid-trip is best-effort — the provider SDK decides whether the in-flight request can be cut. `report.status === "cancelled"` and `error.category === "cancelled"` are stable signals.

## Sessions

`sessionId` is metadata you control. The framework stamps it onto every report node produced during the run so downstream pipelines (cost dashboards, log aggregators) can group by session without joining the report tree.

```ts
const sessionId = "user_42_2026-05-12";

await myAgent.execute("what's my order?", { sessionId });
await myAgent.execute("cancel it", { sessionId });
```

No implicit persistence. No automatic history. Just a string that rides along.

## Events

Names:

- `agent.starting`, `agent.trip.started`, `agent.trip.streaming`, `agent.trip.completed`
- `agent.tool.calling`, `agent.tool.called`, `agent.tool.failed`
- `agent.completed`, `agent.error`

Three subscription tiers, fired in order:

```ts
// Factory level — fires for every execute
ai.agent({ model, on: { "agent.starting": handler } });

// Instance level — returns an unsubscribe
const unsubscribe = myAgent.on("agent.error", handler);

// Per-call level — fires only this run
await myAgent.execute(input, { on: { "agent.trip.completed": handler } });
```

Every payload carries `runId` and `rootRunId` so nested runs (workflow → agent → tool) stitch into one trace.

## Streaming tool guard

A `streamingToolGuard` config recovers a tool call when the model emits the structured input as **text** in the content stream instead of as a real `tool_call`. See the [streaming tool guard recipe](../recipes/streaming-tool-guard) for the full story.

```ts
ai.agent({
  model: someFastModel,
  tools: [suggestFollowupsTool],
  streamingToolGuard: {},  // empty object = on with defaults
});
```

Off by default. Set this explicitly on agents whose registered tools have been observed to leak.

## When to graduate to the next rung

- **Fixed pipeline of several agents** → [Run workflow](../digging-deeper/run-workflow).
- **One input routed across specialists** → [Run supervisor](../digging-deeper/run-supervisor).
- **Multi-turn conversation with persistent session** → orchestrator (v2). For now, persist your own messages and feed via `history`.

## Related

- [Define tools](./define-tools) — typed tools the agent can call.
- [Write system prompts](./write-system-prompts) — composable prompts.
- [Handle errors](../digging-deeper/handle-errors) — the typed error hierarchy.
- [Streaming tool guard recipe](../recipes/streaming-tool-guard) — recovering leaked tool calls.
