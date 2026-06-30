---
title: "Define tools"
description: ai.tool() — typed async functions the model can call. Schema-validated input, automatic dispatch, side-channel artifacts.
sidebar:
  order: 2
  label: "Define tools"
---

Tools are async functions the model can call by name during a trip loop. You declare one with `ai.tool({...})`, pass it in `agent({ tools: [...] })`, and the agent handles dispatch, validation, and error surfacing for you.

## The factory

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const searchTool = ai.tool({
  name: "search_catalog",
  description: "Search the product catalog. Returns matching products with SKU, name, price.",
  version: "v2",
  action: ({ query }) => `Searching the catalog for "${query}"`,
  mode: "feedback",                                    // default — or "silent"
  input: v.object({ query: v.string(), limit: v.number().optional() }),
  execute: async ({ query, limit }, ctx) => {
    return await searchProducts(query, limit ?? 10);
  },
});
```

Returns a `ToolContract<TInput, TOutput>`. One tool can be attached to many agents.

## `description` vs `action` — two roles

Two fields, two audiences:

- **`description`** — what the LLM reads when deciding whether to call this tool. Be specific about what it returns.
- **`action`** — a present-progressive UI string surfaced to humans on `agent.tool.calling` / `agent.tool.called` events. Optional.

```ts
ai.tool({
  name: "search_catalog",
  description: "Search the product catalog. Returns matching products with SKU, name, price.",
  action: ({ query }) => `Searching the catalog for "${query}"`,
  // ...
});
```

`action` accepts a string or a function. The function receives the model's **raw, pre-validation** input — it resolves at the dispatch boundary, *before* `execute`'s schema validation runs — and throws inside it are swallowed, since a UI string isn't worth aborting LLM dispatch over.

## Schemas via Standard Schema V1

Input is typed as `StandardSchemaV1<T>`. Recommended: `@warlock.js/seal`. Zod, Valibot, and hand-rolled schemas all interop because they all implement the same standard.

```ts
const tool = ai.tool({
  name: "get_weather",
  description: "Return the current weather for a city.",
  input: v.object({
    city: v.string(),
    units: v.enum(["c", "f"]).optional(),
  }),
  execute: async ({ city, units }) => fetchWeather(city, units ?? "c"),
});
```

The agent calls `input["~standard"].validate(rawArgs)` before invoking `execute`. Validation failures **do not throw**: the error is recorded on the `ToolCall`, fed back to the model as a tool-error message, and the model gets a chance to correct itself within `maxTrips`.

## What gets sent back to the model

Whatever `execute` resolves with is `JSON.stringify`'d and sent back as the next trip's `tool` message — a plain string is serialized too, so a returned `"hi"` reaches the model as `"hi"` (quotes included). Throw (or return a rejected promise) to signal failure — the agent records the error and tells the model what went wrong.

```ts
execute: async ({ query }) => {
  if (!query) throw new Error("query is required");
  return { items: await search(query) };
}
```

## `mode: "feedback"` vs `mode: "silent"`

Default is `"feedback"`.

- **`mode: "feedback"`** — standard round-trip. The tool's result feeds back into the next trip; the model reads it and replies. Use for tools whose output the model needs to narrate: `search_catalog`, `search_kb`, `ask_question`.
- **`mode: "silent"`** — fire-and-forget. The result is NOT fed back to the model. When EVERY tool call in one generation is silent, the agent loop terminates after dispatch. Use for pure side-effect tools: `update_state`, `set_locale`, telemetry pings.

```ts
ai.tool({
  name: "update_state",
  description: "Persist customer slot-fill across turns.",
  mode: "silent",
  input: v.object({ preferences: v.array(v.string()).optional() }),
  execute: async (patch, ctx) => {
    ctx.artifacts.stateUpdate = patch;
    return { ok: true };   // model never sees this
  },
});
```

The all-silent rule is load-bearing: silent + feedback in the same generation → loop continues (the feedback tool still round-trips, the silent piggybacks).

See [Silent tools recipe](../recipes/silent-tools) for the full pattern and provider behavior table.

## Tool context — `ctx.artifacts`

`execute` accepts an optional second argument — a `ToolContext` with a mutable `artifacts` bag plus the dispatch's `signal`. Use `artifacts` to capture system-only data (renderable blocks, citations, files, telemetry) the LLM should never see.

```ts
ai.tool({
  name: "search_catalog",
  input: v.object({ query: v.string() }),
  execute: async (input, ctx) => {
    const items = await searchItems(input.query);

    ctx.artifacts.blocks ??= [];
    ctx.artifacts.blocks.push({ type: "items", itemIds: items.map(i => i.id) });

    return { total: items.length };   // LLM-visible — what the agent reasons over
  },
});
```

Under a supervisor: the bag starts empty per iteration, accumulates across tool calls in that iteration, and merges into state when the iteration ends (auto-spread by default; configurable via `finalizeArtifacts`). See [Run supervisor](../digging-deeper/run-supervisor).

Standalone (no supervisor): the framework supplies `{ artifacts: {} }`. Mutations are harmless no-ops — useful if the same tool gets used in both contexts.

## Typed artifacts under a supervisor

A supervisor declares `artifactsSchema` and tools registered to it inherit typed `ctx.artifacts.*`:

```ts
ai.supervisor({
  artifactsSchema: v.object({
    blocks: v.array(blockSchema).optional(),
    citations: v.array(citationSchema).optional(),
  }),
  // tools see ctx.artifacts typed as { blocks?, citations? }
});
```

Standalone tools fall back to `Record<string, unknown>`.

## Errors

Every tool-call failure surfaces as `ToolExecutionError` (`code: "TOOL_EXEC_FAILED"`) with `toolName` and `tripIndex`. The root cause attaches via `error.cause`:

- Schema validation → `SchemaValidationError` wrapped in `ToolExecutionError`
- Your `execute` threw → the thrown error is `cause`
- Provider failure mid-dispatch → a `ProviderError` subclass

See [Handle errors](../digging-deeper/handle-errors).

## Inspecting tool calls

Leaf tool dispatches are child nodes on the report tree — filter `report.children` by `type`:

```ts
const result = await myAgent.execute("Pick a city and tell me the weather.");

const toolCalls = result.report.children.filter((c) => c.type === "tool");

for (const call of toolCalls) {
  console.log(call.tripIndex, call.name, call.input, call.output, call.duration);
}
```

Each `ToolCall` is a child report (`type: "tool"`) carrying `tripIndex`, `input`, `output`, plus the shared `name`, `startedAt`, `endedAt`, `duration`.

## Events

- `agent.tool.calling` — `{ tool, input, tripIndex }`
- `agent.tool.called` — `ToolCall & { tool }` (full record)
- `agent.tool.failed` — `{ tool, input, error, tripIndex }`

Subscribe at factory / instance / per-call.

## Workflow or supervisor as a tool

Higher primitives expose `.asTool()`:

```ts
const wrapped = myWorkflow.asTool({
  description: "Run the catalog ingestion workflow",
  inputSchema: v.object({ url: v.string() }),
});

const agent = ai.agent({ model, tools: [wrapped] });
```

Workflow errors surface as `ToolExecutionError` with `cause` pointing at the original `WorkflowError` subclass.

## Related

- [Run agent](./run-agent) — how tools plug into the trip loop.
- [Run supervisor](../digging-deeper/run-supervisor) — artifacts under a supervisor.
- [Handle errors](../digging-deeper/handle-errors) — `ToolExecutionError` and `cause` chain.
- [Silent tools recipe](../recipes/silent-tools) — `mode: "silent"` patterns.
