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

### Cost truth — `usage`

`usage` is more than a token total. It carries the full per-channel breakdown so cost dashboards can tell *how* a number was reached:

```ts
type Usage = {
  input: number;            // prompt tokens (includes cachedTokens)
  output: number;           // completion tokens (includes reasoningTokens)
  total: number;
  cachedTokens?: number;    // input served from the provider's prompt cache (read hits)
  cacheWriteTokens?: number;// input WRITTEN to the cache this call (Anthropic cache_creation)
  reasoningTokens?: number; // the reasoning/thinking subset of output (priced separately when the model does)
  cost?: {                  // computed at emit time from tokens × the model's declared pricing
    input?: number; output?: number; cachedInput?: number; cachedOutput?: number;
  };
};
```

`cost` is captured as a **historical fact** at emit time — stored reports stay accurate even after the upstream pricing table changes. It's `undefined` when no pricing is available (legacy adapters, unknown model names). For one scalar total, sum the populated fields:

```ts
const total =
  (usage.cost?.input ?? 0) + (usage.cost?.output ?? 0) +
  (usage.cost?.cachedInput ?? 0) + (usage.cost?.cachedOutput ?? 0);
```

All five provider adapters report this surface. See the [cost tracking recipe](../recipes/cost-tracking) for rolling it up across a report tree.

### Reasoning and prompt caching

Reasoning-capable and prompt-caching models accept extra `modelOptions`, gated by the model's own `capabilities` — an adapter that lacks the feature **ignores** the option rather than forwarding an unsupported parameter:

```ts
await myAgent.execute(input, {
  modelOptions: {
    reasoning: { effort: "high" },          // honored when capabilities.reasoning
    cacheControl: { breakpoints: 1 },       // honored when capabilities.promptCaching
  },
});
```

`reasoning.effort` maps to the provider-native control (OpenAI `reasoning_effort`); `reasoning.maxTokens` caps the thinking budget. `cacheControl.breakpoints` translates into provider prompt-cache breakpoints. The resulting reasoning / cache token counts flow back through `usage`.

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

## DX helpers around agents

A handful of small utilities take the friction out of common agent patterns. They're not new primitives — each returns a plain agent, model, or result you already know how to use.

### `ai.systemPrompt.fromFile(path)`

Seed a system prompt from a file, read once at construction:

```ts
const writer = ai.agent({
  model,
  systemPrompt: ai.systemPrompt.fromFile("./prompts/writer.md"),
});
```

Also available as `SystemPrompt.fromFile(path)`.

### Executables auto-adapt in `tools: [...]`

You no longer need to call `.asTool()` by hand to compose primitives. Pass a workflow, supervisor, or orchestrator straight into an agent's `tools` array and it is auto-adapted into a tool:

```ts
const concierge = ai.agent({
  model,
  tools: [searchTool, refundWorkflow, supportSupervisor],   // workflow + supervisor auto-adapted
});
```

### `ai.fallbackModel(models, opts?)`

Wrap an ordered model list that fails over to the next on transient provider errors (rate limits, timeouts) — drop it in anywhere a `model` is expected:

```ts
const model = ai.fallbackModel([
  openai.model({ name: "gpt-4o" }),
  anthropic.model({ name: "claude-sonnet-4" }),
]);

const agent = ai.agent({ model });
```

### `ai.batch(executable, items, opts?)`

Run any executable over a dataset with bounded concurrency and per-item retry. A batch never fails as a whole — each item's outcome lives on its own `BatchItemResult`:

```ts
const { items, data, usage, report } = await ai.batch(summarizer, articles, {
  concurrency: 4,
  retry: { attempts: 3, backoff: "exponential" },
  onItem: (item) => log(item.index, item.status),
});

console.log(`${report.succeeded}/${report.total} ok, ${usage.total} tokens`);
```

`data` is the positional array of successful items' `result.data` (with `undefined` in failed slots); `items` is the per-item breakdown. `usage` rolls up across every item.

### Evaluation — `agent.eval(...)`

Run a scored evaluation suite against an agent and get an aggregate `EvalReport`. Each case runs through `execute(input)` and is scored by the resolved scorers; a case passes only when every scorer passes and the agent didn't error:

```ts
const report = await myAgent.eval({
  cases: [
    { name: "capital", input: "Capital of Egypt?", expected: "Cairo" },
  ],
  scorers: [ai.eval.contains()],     // exact / contains / predicate(fn) / judge(config)
});

expect(report.passed).toBe(true);
```

`ai.eval.judge({ agent, rubric })` is LLM-as-judge. In Vitest, `registerAiMatchers()` adds `toRouteTo` / `toConverge` / `toPassStep` / `toOutputShape`. `eval()` never throws on a case failure — failures surface on the report.

### `ai.router()`, `ai.fanOut()`, `ai.mockRouter()`

Supervisor-oriented helpers — see [Run supervisor](../digging-deeper/run-supervisor) for `ai.router()` (generate the routing agent) and `ai.fanOut()` (voting / self-consistency). `ai.mockRouter(decisions)` replays canned routing decisions for supervisor tests.

## When to graduate to the next rung

- **Fixed pipeline of several agents** → [Run workflow](../digging-deeper/run-workflow).
- **One input routed across specialists** → [Run supervisor](../digging-deeper/run-supervisor).
- **Multi-turn conversation with persistent session** → [Run orchestrator](../digging-deeper/run-orchestrator) — durable session state across runs.
- **Plan generated up front, then executed** → [Planner](../architecture-concepts/planner).

## Related

- [Define tools](./define-tools) — typed tools the agent can call.
- [Write system prompts](./write-system-prompts) — composable prompts.
- [Handle errors](../digging-deeper/handle-errors) — the typed error hierarchy.
- [Streaming tool guard recipe](../recipes/streaming-tool-guard) — recovering leaked tool calls.
