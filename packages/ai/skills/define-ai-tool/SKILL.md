---
name: define-ai-tool
description: 'Define tools with ai.tool({...}) — typed validated async functions the model can call. Covers name / description / action / mode (feedback / silent) / input / execute, `ctx.artifacts` side-channel, `ToolExecutionError`. Triggers: `createToolContext`, `measureTools`, `ai.tools.measure`, `toolSchemas`, `compactJsonSchema`, `compactToolSchemas`, `ai.tool`, `ToolContract`, `ToolContext`, `ToolCall`, `ToolExecutionError`, `artifactsSchema`, `mode: "silent"`, `workflow.asTool`, `ai.providerTool`, `ProviderTool`, `providerTools`, `isProviderTool`, `web_search`, `code_execution`, `text_editor`, `googleSearch`, `nova_grounding`; ''define a tool'', ''enable the provider's web search'', ''use Claude's bash / text editor tool'', ''built-in provider tools'', ''wire tool into agent'', ''tool input validation'', ''side-channel artifacts''; typical import `import { ai } from "@warlock.js/ai"`. Skip: agent loop — the `run-ai-agent` topic; supervisor artifacts — the `run-supervisor` topic; competing libs `langchain` tools, raw `openai` function-calling.'
---

# `ai.tool()` — typed tool factory

Tools are async functions the model can call by name during a trip loop. Define one with `ai.tool()`, pass it in `agent({ tools: [...] })`, and the agent handles dispatch, input validation, and error surfacing automatically.

## Factory shape

```ts
ai.tool({
  name: string,                                 // stable identifier
  description: string,                          // sent to the model
  version?: string,                             // mirrored onto tool reports
  action?: string | ((input: TInput) => string), // UI label for streaming UX
  mode?: "feedback" | "silent",                 // result feedback control
  input: StandardSchemaV1<TInput>,              // validated before execute
  execute: (input: TInput, ctx?: ToolContext) => Promise<unknown>,
});
```

Returns a `ToolContract<TInput, TOutput>`. One tool can be attached to many agents.

## `description` vs `action`

Two roles, two fields:

- **`description`** — what the LLM reads when deciding whether to call this tool.
- **`action`** — present-progressive UI string surfaced to humans on `agent.tool.calling` / `agent.tool.called` events.

```ts
ai.tool({
  name: "search_catalog",
  description: "Search the product catalog. Returns matching products with SKU, name, price.",
  action: ({ query }) => `Searching the catalog for "${query}"`,
  input: v.object({ query: v.string() }),
  execute: async ({ query }) => searchProducts(query),
});
```

Two forms supported: static string or function. Function form runs after input validation; throws are swallowed (UI strings aren't worth aborting LLM dispatch over).

## Schema via Standard Schema V1

Input is typed as `StandardSchemaV1<T>`. Recommended: `@warlock.js/seal`. Zod / Valibot / hand-rolled all interop.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

declare function fetchDocs(query: string, limit: number): Promise<string[]>;

const searchTool = ai.tool({
  name: "search",
  description: "Search the docs index",
  input: v.object({
    query: v.string(),
    limit: v.number().optional(),
  }),
  execute: async ({ query, limit }) => fetchDocs(query, limit ?? 10),
});
```

## Input validation is automatic

The agent calls `input["~standard"].validate(rawArgs)` before invoking `execute`. Validation failures **do not throw** — the failure is recorded on the trip's `ToolCall.error` and fed back to the model on the next trip as a tool error message. The model gets a chance to correct and retry within the bounded `maxTrips` loop.

## What gets returned to the model

Whatever your `execute` resolves with is `JSON.stringify`'d and sent back as the next trip's `tool` message. Strings pass through unchanged. Throw (or return a rejected promise) to signal failure — the agent records the error on `ToolCall.error` and tells the model.

## Parallel calls — tools run concurrently

When the model requests several tools in one turn, the agent runs them **concurrently** (default `toolDispatch: "concurrent"`, at most `maxConcurrentTools` — default 4 — at a time) and continues once all settled; results reach the model in request order. A tool that shares mutable state with another (or must see its side effects) needs `ai.agent({ toolDispatch: "sequential" })` or per-call `execute(input, { toolDispatch: "sequential" })`. `ctx.signal` carries the run's cancellation into each call.

## `mode` — feedback vs silent

Default `"feedback"`.

- **`mode: "feedback"`** (default) — standard round-trip. Result feeds back into next trip; the model reads it and replies. Use for tools whose output the model needs to narrate: `search_catalog`, `search_knowledge_base`, `ask_questions`.
- **`mode: "silent"`** — fire-and-forget. Result NOT fed back to the model. When EVERY tool call in a single generation is silent, the agent loop terminates after dispatch. Use for pure side-effect tools: `update_state`, `set_locale`, telemetry pings.

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

**All-silent rule.** The loop terminates only when EVERY tool call this trip is silent. Silent + feedback in the same generation → loop continues (the feedback tool still round-trips, the silent one piggybacks).

**Constraints for silent tools.** MUST be cheap + fast (HTTP request still open until dispatch resolves), should be idempotent (no surface to communicate failure to the model), side-effect-only.

## Tool context — `ctx.artifacts` side-channel

`execute` accepts an optional **second argument** — a `ToolContext` with a mutable `artifacts` bag and the dispatch's `signal`. Use it to capture system-only data (renderable blocks, citations, files, telemetry, soft signals) that the LLM should NOT see.

```ts
ai.tool({
  name: "search_catalog",
  input: v.object({ query: v.string() }),
  execute: async (input, ctx) => {
    const items = await searchItems(input.query);

    // Side-channel — never reaches the LLM.
    ctx.artifacts.blocks ??= [];
    ctx.artifacts.blocks.push({ type: "items", itemIds: items.map((i) => i.id) });

    // LLM-visible — what the agent reasons over.
    return { total: items.length };
  },
});
```

Under a supervisor: bag starts empty per iteration, accumulates writes from all tool calls, merges into state at iteration end (auto-spread by default; `finalizeArtifacts` for concat / dedupe). See the `run-supervisor` topic.

Standalone (no supervisor): framework supplies `{ artifacts: {} }`. Mutations are harmless no-ops.

Invoking a tool yourself (script, test, HTTP handler) with a `signal`, or to read back what it wrote? Use `createToolContext` instead of faking the bag:

```ts
import { ai, createToolContext } from "@warlock.js/ai";

const pinLocale = ai.tool({
  name: "pin_locale",
  description: "Remember the customer's locale",
  execute: async (_input: unknown, ctx) => {
    if (ctx) ctx.artifacts.locale = "en-GB";
    return { ok: true };
  },
});

const controller = new AbortController();
const ctx = createToolContext({ signal: controller.signal }); // { artifacts: {}, signal }
const { data } = await pinLocale.invoke({}, ctx);

console.log(data, ctx.artifacts.locale); // { ok: true } "en-GB"
```

## MCP request identity

When served by `@warlock.js/ai-tools`, `ToolContext` also carries optional
`requestId` (the original JSON-RPC string/number id), `principal` (unknown,
from HTTP `auth.authenticate` or stdio identity options), and `signal` that
aborts on request cancellation or disconnect/shutdown. Narrow the principal
before using it; none of this metadata is automatically returned to the model.

```ts
const identity = ai.tool({
  name: "identity",
  description: "Read server-provided identity",
  execute: async (_input: unknown, ctx) => {
    ctx?.signal?.throwIfAborted();
    return { requestId: ctx?.requestId, principal: ctx?.principal };
  },
});
```

See the `expose-as-mcp-server` skill in `@warlock.js/ai-tools` for
`authenticate`, `beforeCall` and `notifications/cancelled`.

## Type contract for artifacts

The supervisor declares an `artifactsSchema`; tools registered to it inherit typed `ctx.artifacts.*`. Standalone tools fall back to `Record<string, unknown>`.

```ts
ai.supervisor({
  artifactsSchema: v.object({
    blocks: v.array(blockSchema).optional(),
    citations: v.array(citationSchema).optional(),
  }),
  // tools see ctx.artifacts typed as { blocks?, citations? }
});
```

## Error categorization

`invoke()` never throws — failures surface on the returned `error` field, and the agent records them on the dispatch's `ToolCall.error`. The error class depends on what failed:

- **Input schema rejected the model's args** → `SchemaValidationError` (`code: "SCHEMA_VALIDATION_FAILED"`), `issues` preserved. NOT wrapped in `ToolExecutionError`.
- **Schema's own `validate()` threw** → `SchemaValidationError` wrapping the cause.
- **Your `execute()` threw** → `ToolExecutionError` (`code: "TOOL_EXEC_FAILED"`, category `tool`) with `toolName`, and the thrown value on `error.cause`.

`ToolExecutionError` carries `toolName` always; `tripIndex` is stamped by the agent that dispatched it. The validation failure is fed back to the model on the next trip so it can correct within the `maxTrips` loop.

See the `handle-ai-errors` topic.

## Inspecting tool calls

```ts
const result = await myAgent.execute("Pick a city and tell me the weather.");

const toolCalls = result.report.children.filter((c) => c.type === "tool");

for (const call of toolCalls) {
  console.log(call.tripIndex, call.name, call.input, call.output, call.duration);
}
```

Tool dispatches are child `BaseReport` nodes on `report.children` (not a separate `report.toolCalls` field) — filter by `c.type === "tool"`. Each `ToolCall` is a `BaseReport & { type: "tool", tripIndex, input, output?, error? }`, so it carries `name` / `startedAt` / `endedAt` / `duration` from the report base.

## Events

- `agent.tool.calling` — `{ tool, input, tripIndex }`
- `agent.tool.called` — `ToolCall & { tool }` (full record)
- `agent.tool.failed` — `{ tool, input, error, tripIndex }`

Subscribe at factory / instance / per-call.

## Provider-defined tools — `ai.providerTool()`

A provider's own tools (Anthropic `web_search` / `web_fetch` / `code_execution` / `bash` / `text_editor` / `memory`, OpenAI Responses `web_search` / `file_search` / `code_interpreter`, Gemini `googleSearch` / `codeExecution` / `urlContext`, Bedrock `systemTool`s) take the provider's own JSON. `definition` is sent **verbatim** to the provider named by `provider`; every other adapter skips it and logs one `providerTool.skipped` warning, so one list serves a fallback chain.

```ts
// Server-run: the provider executes it inside the response. No execute.
const webSearch = ai.providerTool({
  provider: "anthropic",
  definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
});
const grounding = ai.providerTool({ provider: "google", definition: { googleSearch: {} } });

// Client-run with a provider schema: the model calls it like any tool, your code runs it.
const bash = ai.providerTool({
  provider: "anthropic",
  definition: { type: "bash_20250124", name: "bash" },
  execute: async (input: { command?: string; restart?: boolean }) => sandbox.run(input),
});

const assistant = ai.agent({ model, tools: [webSearch, grounding, bash, lookupOrder] });
```

- `provider`: the adapter wire format (`"anthropic"`, `"openai"` — Responses API, `"google"`, `"bedrock"`, `"ollama"`) or an OpenAI-compatible model's provider label (`"groq"`, `"xai"`, …).
- The agent sends provider tools as `ModelCallOptions.providerTools`, never as function tools. Direct model calls: `model.complete(messages, { providerTools: [{ provider, definition }] })`.
- `name` defaults to `definition.name` → `definition.type` → the single key (`googleSearch`) or nested name (`nova_grounding`).
- Anthropic server-tool result blocks round-trip through `Message.blocks`. OpenAI Responses hosted-tool items are not replayed (`store: false`); client-run OpenAI built-ins (`shell`, `apply_patch`, `computer`, `custom`) throw `InvalidRequestError`.
- `providerOptions.<adapter>.body` still may not set `tools`.

## Pattern — workflow as a tool

```ts
const wrapped = myWorkflow.asTool({
  description: "Run the catalog ingestion workflow",
  inputSchema: v.object({ url: v.string() }),
});

const agent = ai.agent({ model, tools: [wrapped] });
```

Workflow errors surface as `ToolExecutionError` with `cause` pointing at the original `WorkflowError` subclass.

## Schema token cost — measure, then go compact

Every tool's JSON schema is re-sent on every trip. `measureTools` (also `ai.tools.measure` with `@warlock.js/ai-tools`) reports what the list costs per call: native and exact when the model has `countTokens` (Anthropic, Google, Bedrock, OpenAI Responses — `tools.length + 2` count calls, `perTool` = each tool's marginal cost, `overhead` = the provider's once-per-request tool preamble), estimated from the schema JSON otherwise. `source` says which.

```ts
import { ai, compactJsonSchema, extractJsonSchema, measureTools } from "@warlock.js/ai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const model = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" }).model({
  name: "claude-sonnet-4-6",
});
const lookup = ai.tool({
  name: "lookup_order",
  description: "Look up an order by id",
  execute: async () => ({ status: "shipped" }),
});

const full = await measureTools([lookup], { model });
const compact = await measureTools([lookup], { model, mode: "compact" });
console.log(full.source, full.tokens, "→", compact.tokens, full.perTool);

// Send compact schemas on every trip (per call: execute(input, { toolSchemas })).
const agent = ai.agent({ model, tools: [lookup], toolSchemas: "compact" });

// The same transform, by hand:
extractJsonSchema(lookup.input, { compact: true });
compactJsonSchema({ type: "string", description: "Order id", examples: ["A-1"] }); // { type: "string" }
```

Compact mode drops `description` / `title` / `examples` / `example` / `default` / `$comment` / `deprecated` / `readOnly` / `writeOnly` / `$schema` at every level and collapses `anyOf` / `oneOf` of bare `const` branches into `enum` (`{ keepDescriptions: true }` keeps descriptions). Validation and property names are untouched; the tool's own `description` is always sent. Trade-off: no per-field guidance for the model — name fields clearly and keep must-know rules in the tool `description`. `compactToolSchemas(tools)` returns compact copies for direct `model.complete(messages, { tools })` calls.

## See also

- The `run-ai-agent` topic — how tools plug into the trip loop
- The `handle-ai-errors` topic — error hierarchy
- The `run-supervisor` topic — artifacts under a supervisor
- The `run-ai-workflow` topic — `workflow.asTool()` composition

## Native search: counters and compatible transports

Read `response.usage.serverToolUse` for provider-reported hosted usage and
`response.providerMetadata` for raw OpenAI hosted output / Google grounding;
Anthropic hosted blocks remain on `response.blocks`. Never count answer text
or ordinary function calls as billable hosted usage. Hosted tools bypass
application handlers.

Qwen/DashScope search is a request flag, not a tool:

```ts
await qwenModel.complete(messages, {
  providerOptions: { qwen: { enableSearch: true } }, // model provider must be "qwen"
});
```

Kimi's legacy `$web_search` builtin retires on **20 October 2026** and is
unsupported. Use first-party REST client tools from `@warlock.js/ai-openai`:

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK, kimiSearchTool, kimiFetchTool } from "@warlock.js/ai-openai";

const config = {
  apiKey: process.env.MOONSHOT_API_KEY ?? "",
  baseURL: "https://api.moonshot.ai/v1",
};
const moonshot = new OpenAISDK({ ...config, provider: "moonshot" });
const assistant = ai.agent({
  model: moonshot.model({ name: "kimi-k3" }),
  maxTrips: 4,
  tools: [kimiSearchTool({ ...config, mode: "pro" }), kimiFetchTool(config)],
});
```

These ordinary client tools execute `/v1/tools/search`, `search_pro`, and
`fetch`. They honour cancellation and return compact source results. Their
`invoke()` envelopes carry billable REST-response counts and request costs;
agents aggregate them through the existing tool accounting boundary. Basic,
Pro and Fetch have separate namespaced counters and prices. Qwen's flag still
has no verified billing counter mapped. xAI's hosted search uses Responses and
is rejected by the current Chat Completions XaiSDK. Full shapes and official
sources: https://warlock.js.org/v/latest/ai/providers/openai-compatible/
