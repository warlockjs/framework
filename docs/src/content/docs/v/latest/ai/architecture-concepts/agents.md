---
title: "Agents"
description: The mental model behind ai.agent — trip loop, tool dispatch, structured output, streaming, lifecycle events.
sidebar:
  order: 1
  label: "Agents"
---

An agent is the lowest rung of the ladder — one LLM call, optionally wrapped in a tool loop, optionally producing structured output. It's stateless across calls: each `agent.execute()` runs in fresh isolation, even if the same agent instance is shared.

This page is the mental model. For the API surface see [Run agent](../the-basics/run-agent).

## One agent, one trip loop

When you call `agent.execute(input)`, the agent runs a **trip loop**. A trip is a single round-trip to the model.

```text
trip 0:  send messages → receive response
         ├─ if no tool calls            → finalize, return
         └─ if tool calls                → dispatch tools, append results
trip 1:  send updated messages → receive response
         ├─ if no tool calls            → finalize, return
         └─ if tool calls                → dispatch, repeat
...
trip N:  bound by maxTrips (default 10)
```

The loop terminates when:

1. The model returns a response with no tool calls — the agent finalizes and returns.
2. Every tool call this trip is `mode: "silent"` — see [Define tools](../the-basics/define-tools).
3. `maxTrips` is hit — the agent returns with the latest text and a warning logged.

Each trip is recorded on `result.report.trips[]` with its index, finish reason, usage, and timing.

## What "stateless across calls" means

The agent factory holds configuration only. Per-call state — the messages list, the tool-call records, the running usage, the trip index — lives in a fresh internal `Execution` object spawned for each `execute()` call.

That means:

- Two calls with the same agent don't share history. Pass `history: Message[]` explicitly when you want one to follow the other.
- Anonymous agents (no `name` field) get a deterministic fingerprint based on provider, model, and tools. Same config → same synthetic name across process restarts.
- Sharing an agent across requests in a Node server is safe. There's no internal mutable state to corrupt.

## Structured output

Pass an `output` schema and you get a typed `data` field back:

```ts
const schema = v.object({ title: v.string(), tags: v.array(v.string()) });

const myAgent = ai.agent({ model, output: schema });

const { data } = await myAgent.execute(input);
//      ^? { title?: string; tags?: string[] } | undefined
```

Two execution paths under the hood:

- **Native** — adapters whose `capabilities.structuredOutput === true` forward the schema as JSON Schema to the provider (`response_format: json_schema` on OpenAI). The provider constrains the output at decode time.
- **Soft** — adapters without native support get a system-prompt addition: "respond as JSON matching this schema". The agent then validates client-side.

Client-side validation always runs. Set `repair: { maxAttempts: 1 }` to re-ask the model on validation failure.

## Tool dispatch

Tools are typed async functions the model can call. The agent:

1. Tells the model what tools exist (name, description, JSON Schema of input).
2. When the model emits a tool call, validates input against the tool's schema.
3. Invokes `tool.execute(input, ctx)`.
4. Stringifies the result and feeds it back on the next trip.

If input validation fails or the tool throws, the error is recorded on the `ToolCall` and reported back to the model on the next trip. The model gets a chance to correct itself, bounded by `maxTrips`.

There's a side-channel — `ctx.artifacts` — for system-only data the model should never see (renderable blocks, citations, telemetry). See [Define tools](../the-basics/define-tools).

## Streaming

`agent.stream(input)` returns an async iterable of typed events plus a `.result` promise:

```ts
const stream = myAgent.stream(input);

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") {
    process.stdout.write(event.delta);
  }
}

const result = await stream.result;
```

The same lifecycle events fire whether you call `execute` or `stream` — streaming just opens up the per-token deltas in addition. Token deltas are NOT logged at framework level (`agent.trip.streaming` is not pushed to channels) — trip boundaries carry the same information at a saner volume.

## Events — three subscription tiers

Lifecycle events fire in three places, in order:

1. **Factory level** — `ai.agent({ on: {...} })`. Fires for every execution of this agent.
2. **Instance level** — `myAgent.on("agent.error", handler)`. Returns an unsubscribe function.
3. **Per-call level** — `myAgent.execute(input, { on: {...} })`. Fires only for this call.

All matching handlers fire in that order. Every event payload carries `runId` and `rootRunId` so you can stitch nested runs (workflow → agent → tool) into one trace.

## Cancellation

Pass an `AbortSignal`:

```ts
const ctrl = new AbortController();
const promise = myAgent.execute(input, { signal: ctrl.signal });

setTimeout(() => ctrl.abort("too slow"), 30_000);

const { error, report } = await promise;
```

Between-trip cancellation is guaranteed. Mid-trip is best-effort — the provider SDK decides whether the in-flight request can be aborted. `report.status` reads `"cancelled"` and `error` is an `AgentExecutionError` carrying the abort reason.

## Sessions

`sessionId` is a caller-supplied string that gets stamped onto every report node produced during a run. Use it to group cost dashboards or trace logs by user session:

```ts
const sessionId = "user_42_2026-05-12";

await myAgent.execute("what's my order?", { sessionId });
await myAgent.execute("cancel it", { sessionId });
```

The framework doesn't interpret it. No persistence, no implicit history — it's metadata for your downstream pipelines.

## Where state actually lives

The agent doesn't remember anything across calls. State you need to persist lives in:

- **The `history` option** — pass `Message[]` on the next call to continue a conversation.
- **Tool side effects** — write to your DB inside `tool.execute`.
- **Middleware `ctx.state`** — per-execute scratch space for middleware, fresh on every call.
- **Workflow snapshots** — when you graduate to `ai.workflow()`, the snapshot store keeps a per-step checkpoint.
- **Supervisor snapshots** — same idea for supervisors, per-iteration.

If you want a long-lived conversation that "remembers" across runs, the [`ai.orchestrator()`](./orchestrators) primitive owns this for you — durable session state, history windowing, and optional [memory](./memory). You still hold the raw transcript and replay it via `history`; the orchestrator persists the *session state* around it.

## Related

- [Run agent](../the-basics/run-agent) — the API surface in depth.
- [Define tools](../the-basics/define-tools) — tool authoring.
- [Write system prompts](../the-basics/write-system-prompts) — composable prompts.
- [Workflows](./workflows) — when one agent isn't enough.
