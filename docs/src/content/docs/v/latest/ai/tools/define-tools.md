---
title: "Define tools"
description: ai.tool() — typed async functions the model can call. Schema-validated input, automatic dispatch, side-channel artifacts.
sidebar:
  order: 1
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
  mode: "feedback", // default — or "silent"
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

`action` accepts a string or a function. The function receives the model's **raw, pre-validation** input — it resolves at the dispatch boundary, _before_ `execute`'s schema validation runs — and throws inside it are swallowed, since a UI string isn't worth aborting LLM dispatch over.

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

## Schema size — measure it, send it compact

The JSON schema of every tool is sent on every trip, so a long tool list is a fixed cost on each call. Measure it, per tool and in total:

```ts
import { measureTools } from "@warlock.js/ai";

const report = await measureTools([weatherTool, searchTool], { model, mode: "full" });
// { tokens, perTool: [{ name, tokens }], overhead, source: "native" | "estimate", mode }
```

- **Native** — when `model` has a count endpoint (`countTokens`: Anthropic, Google, Bedrock, OpenAI Responses), the counts are exact for that model. It makes `tools.length + 2` count calls (no tools, all tools, and each tool left out), so `perTool` is each tool's marginal cost and `overhead` is what the provider adds once whenever any tool is present.
- **Estimate** — otherwise each tool's schema JSON at `charsPerToken` (default 4) characters per token; `source` is `"estimate"` and `overhead` is `0`.

`ai.tools.measure(tools, options)` is the same function, available in AI core.

To shrink the bill, send the schemas compact — per agent, or per call:

```ts
const lean = ai.agent({ model, tools: [weatherTool, searchTool], toolSchemas: "compact" });
await lean.execute("weather in Cairo?", { toolSchemas: "full" }); // per-call override
```

Compact mode (`compactJsonSchema`) drops `description`, `title`, `examples`, `example`, `default`, `$comment`, `deprecated`, `readOnly`, `writeOnly` and `$schema` at every level, and collapses an `anyOf` / `oneOf` of bare `const` branches into one `enum`. Validation keywords and property names are untouched, so strict-mode providers accept it as they accept the full schema, and the tool still validates against its original schema. The trade-off: the model loses per-field guidance — give fields self-explanatory names and keep essential instructions in the tool's `description`, which is always sent.

The same helpers are available directly:

```ts
import { compactJsonSchema, compactToolSchemas, extractJsonSchema } from "@warlock.js/ai";

const compactSchema = extractJsonSchema(weatherTool.input, { compact: true });
const withDescriptions = extractJsonSchema(weatherTool.input, {
  compact: { keepDescriptions: true },
});
const tools = compactToolSchemas([weatherTool, searchTool]); // for model.complete(messages, { tools })
const fromJson = compactJsonSchema({
  type: "string",
  description: "City name",
  examples: ["Cairo"],
});
// { type: "string" }
```

`extractJsonSchema` converts a schema once per target and `compact` setting and returns the same object on later calls — every model call sends the same tool schemas, so the conversion is not repeated. Treat the result as read-only; copy it before changing it.

## Discover tools from a stable catalogue

`ai.tools.catalogue({ core, searchable, limit? })` ships in `@warlock.js/ai` itself, alongside `ai.tools.measure`. The named `catalogue` export is the same factory. Give the agent `catalogue.tools`: it advertises the core and two fixed meta-tools, `tool_search` and `tool_call`. Search results carry schemas in tool messages; they never expand the advertised definitions on later trips.

```ts
import { ai, type ModelContract } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

declare const model: ModelContract;

const status = ai.tool({
  name: "status",
  description: "Read service status",
  execute: async () => ({ ready: true }),
});
const surface = ai.tools.catalogue({
  core: [status],
  limit: 8,
  searchable: [
    {
      name: "archive_note",
      description: "Archive a note by id",
      tags: ["notes", "archive"],
      load: async () =>
        ai.tool({
          name: "archive_note",
          description: "Archive a note by id",
          input: v.object({ id: v.string() }),
          execute: async ({ id }) => ({ archived: id }),
        }),
    },
  ],
});
const assistant = ai.agent({
  model,
  tools: surface.tools,
  middleware: [
    ai.human.approval({
      policy: { type: "allowlist", tools: ["archive_note"] },
      handler: async () => ({ type: "reject", reason: "Archiving requires operator review" }),
    }),
  ],
});
```

The model searches with `{ query: "notes archive" }`, receives `{ tools: [{ name, description, inputSchema }] }`, then calls `tool_call` with `{ name: "archive_note", input: { id: "n-1" } }`. `surface.search` and `surface.call` expose the two contracts; `searchName` and `callName` customize their names to avoid collisions. All core, searchable and meta-tool names must be distinct. `core` defaults to `[]` and contains eager contracts; `searchable` accepts eager `ToolContract`s or lazy descriptors with `name`, `description`, optional `tags`, and `load()`.

Search is case-insensitive. Every whitespace-separated term must match the name, description or tags. Each term scores 100 for an exact name, 20 for a name substring, 10 for a tag substring, or 1 for a description substring; scores add together, with ties sorted by case-sensitive name using code-unit order. Duplicate terms count once. `*` lists tools alphabetically and an empty query returns no results. Queries are limited to 500 characters. `limit` is a positive safe integer, defaults to 8, and cannot be overridden by the model. Eager tools use `meta: { tags: ["notes"] }` for tags.

Only the selected matches load, after ranking and the result cap. A direct call can load a named hidden tool without a prior search. Successful loads and concurrent in-flight loads are shared for the catalogue's lifetime; failures can be retried. A loader must return an ordinary tool with the declared name. Search returns the resolved tool's actual description and full JSON input schema, extracted as `draft-2020-12`, even with `toolSchemas: "compact"`. A schema-less tool gets the usual empty-object schema; a schema that cannot expose JSON fails search rather than returning a guessed definition. Use a lazy import inside `load` to defer implementation modules as well as schemas.

Hidden calls resolve to their target **before** the agent's normal tool pipeline. Target name, raw input and description reach policy middleware and approval/HITL; approval edits still pass through the target's own Standard Schema validation. Cancellation, artifacts and identity context, concurrency limits, silent mode, nested reports, usage and budgets use the same path as a directly advertised tool. Events and report nodes identify the target and keep the original provider call id; conversation history keeps the model's meta-call. Hidden inventory participates in durable drift detection without loading tools. Bump the agent's `version` when changing target behavior or schemas, as for other tools.

The call meta-tool can invoke only this catalogue's searchable inventory: core tools are called directly, and other meta-tools are excluded. Calling `surface.call.invoke()` or `.execute()` outside an agent fails closed because standalone invocation has no agent policy pipeline. Search is discovery, not an access-control filter; execution always checks current middleware, so a discovered schema does not grant permission. Supply an inventory appropriate for the current user if tool names or descriptions are sensitive.

Native provider tools stay outside discovery. Prefer `tools: [...surface.tools, hostedSearch]`. If a provider tool is included in `core` or `searchable`, it passes through unchanged in the advertised list, remains a provider tool on the wire, and cannot be found or invoked through the catalogue. Lazy loaders cannot return provider tools.

### Measure the fixed tool cost

Compare the full eager list against the advertised list using the same model and representative messages:

```ts
import { ai, type ModelContract, type ToolContract } from "@warlock.js/ai";

declare const model: ModelContract;
declare const core: ToolContract[];
declare const searchable: ToolContract[];
const surface = ai.tools.catalogue({ core, searchable });
const messages = [{ role: "user" as const, content: "Find a note" }];
const full = await ai.measure({ model, messages, tools: [...core, ...searchable] });
const discovered = await ai.measure({ model, messages, tools: surface.tools });
console.log(full.parts.tools.tokens, discovered.parts.tools.tokens);
console.log(ai.measure.diff(full, discovered).parts.tools); // negative tokens = saving
const schemas = await ai.tools.measure(surface.tools, { model });
console.log(schemas.tokens, schemas.source);
```

Measurement of `surface.tools` does not load hidden schemas or execute tools. Native token counts or labelled estimates include the core and both meta-tools. Loading every hidden tool to measure a full baseline is an explicit application choice; keep an eager baseline when comparing. Search-result schemas and extra search/call turns cost tokens in conversation history, so also measure representative later messages to assess the total tradeoff. The catalogue targets the fixed tool-definition cost paid on every trip.

## What gets sent back to the model

Whatever `execute` resolves with is `JSON.stringify`'d and sent back as the next trip's `tool` message — a plain string is serialized too, so a returned `"hi"` reaches the model as `"hi"` (quotes included). Throw (or return a rejected promise) to signal failure — the agent records the error and tells the model what went wrong.

```ts
execute: async ({ query }) => {
  if (!query) throw new Error("query is required");
  return { items: await search(query) };
};
```

### Images and text parts

A tool can show the model a picture, such as a browser screenshot. Return an object whose only key is `content`, a non-empty array of text and image parts:

```ts
execute: async () => ({
  content: [
    { type: "text", text: "Screenshot of /pricing" },
    { type: "image", source: { base64: png.toString("base64"), mediaType: "image/png" } },
  ],
});
```

Media types are `image/png`, `image/jpeg`, `image/webp` and `image/gif`. A return value counts as content parts only when it has exactly the one key `content` and every element is a valid part; any other value, including an object that has other keys next to `content`, is serialised as JSON as before. `isToolResultContent(value)`, exported from `@warlock.js/ai`, runs the same check; `toolResultText(content)` flattens parts to text with `TOOL_RESULT_IMAGE_PLACEHOLDER` for adapters of your own. The types are `ToolResultPart`, `ToolResultContent` and `ToolResultImageMediaType`.

The parts travel on the `tool` message. Anthropic, Bedrock Converse and OpenAI with `api: "responses"` pass the images to the model (`capabilities.toolResultImages: true`). Every other adapter (OpenAI chat, Google, Ollama, the OpenAI-compatible wrappers, CLI agents) sends the text `[image omitted: provider cannot read images in tool results]` in place of each image and reports `toolResultImages: false`. Image bytes count toward request-size estimates like attachment images, and context editing replaces an old image result with the cleared-result placeholder. MCP tools that return `image` content blocks are forwarded as image parts.

## `memoize` — reuse results of read-only tools

An agent often asks the same lookup twice in one run. Mark a read-only tool with `memoize` and a repeat call with the same arguments returns the first result without running `execute()`:

```ts
const getOrder = ai.tool({
  name: "get_order",
  description: "Fetch an order by id",
  input: orderIdSchema,
  memoize: true,
  execute: ({ id }) => orders.find(id),
});

const getPlans = ai.tool({
  name: "get_plans",
  description: "List the plans on sale",
  memoize: { scope: "session", ttl: 60_000 },
  execute: () => plans.list(),
});
```

- `memoize: true` is `{ scope: "run" }`: results are shared inside one agent run, including identical calls inside one parallel trip.
- `{ scope: "session" }` shares them across runs with the same `sessionId`, for `ttl` milliseconds (default 5 minutes). Without a `sessionId` it behaves as `"run"`. The session memo lives in this process's memory.
- Arguments are compared after sorting object keys, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same call.
- A failed call is never kept; the next call runs the tool again.
- A hit costs nothing and is marked `memoized: true` on the tool's call record (`result.report.children`) and in the `agent.tool.called` event. Middleware around the tool call (budgets, approvals) still runs.
- Use it for **read-only** tools only. A tool with side effects would silently skip them on a repeat call.

## Parallel tool calls

When the model asks for several tools in one turn, the agent runs them **concurrently** and waits for all of them before the next trip. The results reach the model in the order it requested them, whichever finishes first.

At most four run at once by default; further calls start as earlier ones finish. A model (or text injected into its context) can request many calls in one turn, so the cap bounds the processes and requests they can start. Change it with `maxConcurrentTools`:

```ts
const agent = ai.agent({ model, tools, maxConcurrentTools: 2 });
```

Tools that share mutable state, or must see each other's side effects, can run one after another instead. Each call's result is added to the conversation before the next call starts, so tool middleware sees the earlier results of the same turn:

```ts
const agent = ai.agent({ model, tools: [reserveSeat, chargeCard], toolDispatch: "sequential" });

// or for a single run
await agent.execute(input, { toolDispatch: "sequential" });
```

Models often put dependent calls in one turn, such as writing a file and then running it. Concurrent dispatch starts both at once, and sequential dispatch loses the parallel reads. `toolDispatch: "ordered"` keeps both: mark tools that only read with `readOnly: true`, and consecutive read-only calls run together (still capped by `maxConcurrentTools`) while any other call runs alone, after every earlier call of the turn has finished and before any later one starts:

```ts
const readFile = ai.tool({ name: "read_file", readOnly: true, input, execute });
const agent = ai.agent({ model, tools: [readFile, writeFile, runShell], toolDispatch: "ordered" });
```

A call to a catalogue tool counts as the tool it resolves to, and a tool that is not registered fails at once without delaying the others. Results still reach the model in request order, and `tool` middleware `before` hooks start in request order. `readOnly` defaults to `false`; the workspace tools that only read (`read_file`, `grep`, `glob`, `list_dir`, `shell_output`) and the read-only `ai-tools` (`fetch_url`, `web_search`, `calculator`, `date_time`) declare it. Use `"ordered"` for agents with workspace tools. The default stays `"concurrent"`.

## Knowing which call you are running

Every tool call an agent dispatches gets the model's tool-call id on the context as `ctx.callId` (the same id as `callId` on `agent.tool.calling`, `agent.tool.called` and `agent.tool.failed`). A tool that reports live progress can tag it with that id so the host matches it to the call. It is absent when you call `tool.invoke()` yourself without passing one.

```ts
ai.tool({
  name: "build",
  input,
  execute: async (input, ctx) => {
    progress.emit({ callId: ctx?.callId, text: "started" });
    return runBuild(input);
  },
});
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
    return { ok: true }; // model never sees this
  },
});
```

The all-silent rule is load-bearing: silent + feedback in the same generation → loop continues (the feedback tool still round-trips, the silent piggybacks).

See [Silent tools recipe](/v/latest/ai/recipes/silent-tools/) for the full pattern and provider behavior table.

## Tool context — `ctx.artifacts`

`execute` accepts an optional second argument — a `ToolContext` with a mutable `artifacts` bag plus the dispatch's `signal`. Use `artifacts` to capture system-only data (renderable blocks, citations, files, telemetry) the LLM should never see.

```ts
ai.tool({
  name: "search_catalog",
  input: v.object({ query: v.string() }),
  execute: async (input, ctx) => {
    const items = await searchItems(input.query);

    ctx.artifacts.blocks ??= [];
    ctx.artifacts.blocks.push({ type: "items", itemIds: items.map((i) => i.id) });

    return { total: items.length }; // LLM-visible — what the agent reasons over
  },
});
```

Under a supervisor: the bag starts empty per iteration, accumulates across tool calls in that iteration, and merges into state when the iteration ends (auto-spread by default; configurable via `finalizeArtifacts`). See [Run supervisor](/v/latest/ai/orchestration/run-supervisor/).

Standalone (no supervisor): the framework supplies `{ artifacts: {} }`. Mutations are harmless no-ops — useful if the same tool gets used in both contexts.

Calling a tool yourself — from a script, a test, an HTTP handler — and need to pass a `signal` or read back what it wrote? Build the context with `createToolContext` instead of faking the `artifacts` bag:

```ts
import { createToolContext } from "@warlock.js/ai";

const controller = new AbortController();
const ctx = createToolContext({ signal: controller.signal }); // { artifacts: {}, signal }

const { data, error } = await searchCatalog.invoke({ query: "lamps" }, ctx);
console.log(data, error, ctx.artifacts.blocks);
```

When a server transport runs the tool for a remote client — `ai.mcp.serve` over HTTP from `@warlock.js/ai-tools` — `ctx.request` carries the inbound request's `headers` (lower-cased names) and `remoteAddress`. Read a per-user token or a tenant header there; like `artifacts`, it never reaches the model. Both MCP transports also supply optional `ctx.requestId` (the JSON-RPC tools/call id) and `ctx.principal` (the authenticated caller, typed `unknown`); narrow the principal before use. MCP cancellation aborts the call's `ctx.signal`. In-process dispatch can leave these fields unset. See [Connect MCP](/v/latest/ai/tools/connect-mcp/).

```ts
execute: async (input, ctx) => {
  const tenant = ctx?.request?.headers["x-tenant-id"];
  return searchItems(input.query, { tenant });
},
```

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

See [Handle errors](/v/latest/ai/reliability/handle-errors/).

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

## Provider-defined tools

A provider's own tools (Anthropic `web_search` / `bash`, OpenAI Responses `web_search`, Gemini `googleSearch`, …) are declared with `ai.providerTool({ provider, definition })` and sit in the same `tools` list. See [Provider-defined tools](/v/latest/ai/tools/provider-tools/).

## Related

- [Run agent](/v/latest/ai/agents/run-agent/) — how tools plug into the trip loop.
- [Run supervisor](/v/latest/ai/orchestration/run-supervisor/) — artifacts under a supervisor.
- [Handle errors](/v/latest/ai/reliability/handle-errors/) — `ToolExecutionError` and `cause` chain.
- [Silent tools recipe](/v/latest/ai/recipes/silent-tools/) — `mode: "silent"` patterns.
- [Lint tool schemas](/v/latest/ai/tools/lint-tool-schemas/) — per-provider schema checks and token cost.
