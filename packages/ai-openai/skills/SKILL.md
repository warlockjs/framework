---
name: warlock-js-ai-openai
description: 'OpenAI and compatible endpoints for Warlock AI: `OpenAISDK`, `OpenAIEmbedder`, `OpenAIImageModel`, `kimiSearchTool`, `kimiFetchTool` and pricing registries. Use for "connect OpenAI", Responses or Chat Completions, reasoning, caching, embeddings, images, speech, transcription or Kimi search. Not this package → @warlock.js/ai for agents; @warlock.js/ai-anthropic for Claude; @warlock.js/ai-ollama for local Ollama.'
---

# `@warlock.js/ai-openai`

Provider adapter that turns OpenAI Chat Completions into a vendor-neutral `ModelContract`. Pair with `@warlock.js/ai` for the agent / tool / system-prompt surface.

## Construction

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// OpenAI-compatible endpoints (Azure OpenAI, OpenRouter, local gateways).
// Pass `provider` to label the upstream — flows through to
// `ModelContract.provider`, `AgentReport.model.provider`, and logs.
const openrouter = new OpenAISDK({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  provider: "openrouter",
});
```

`OpenAISDK` is a class (not a factory) — adapter entry points hold a long-lived `OpenAI` client and align with `new OpenAI(...)` upstream convention.

`provider` defaults to `"openai"`. It's an SDK-level identity (one client = one upstream), not a per-model knob.

## Producing a model

```ts
openai.model({ name: "gpt-4o-mini" }); // common case
openai.model({ name: "gpt-4o", temperature: 0.2 }); // sampling controls
openai.model({ name: "fine-tuned-x", vision: true }); // explicit capability override
```

Returns a `ModelContract` you pass straight into `ai.agent({ model })`.

## Capabilities — what's auto-set

| Flag               | Default                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structuredOutput` | `true`, unless `responseFormat` is set to `"json_object"` or `"text"` (loose modes) — then `false`.                                                                                                                   |
| `vision`           | Inferred from model name. `true` for `gpt-4o*`, `gpt-4-turbo*`, `gpt-4.1*`, `o1*`, `o3*`, `chatgpt-4o*`; `false` otherwise.                                                                                           |
| `reasoning`        | Inferred from model name. `true` for the o-series (`o1*`, `o3*`, `o4*`) and the `gpt-5*` family; `false` otherwise. Drives whether `reasoning_effort` is forwarded.                                                   |
| `promptCaching`    | `true` for the direct OpenAI provider. It supports automatic cache hits plus explicit content-part write breakpoints; wrappers send only `prompt_cache_key`, and only where the endpoint documents it (xAI, Mistral). |
| `pdf`              | `false` by default (opt-in `.model({ pdf: true })`). OpenAI accepts PDF `file` parts only on specific models (the `gpt-4o` family) — honest off until you set it.                                                     |
| `audio`            | `false` by default (opt-in `.model({ audio: true })`). Only the `gpt-4o-audio-preview` family accepts `input_audio`.                                                                                                  |

**Override `vision`, `structuredOutput`, `reasoning`, `pdf`, or `audio` explicitly** via `.model({ name, vision?, structuredOutput?, reasoning?, pdf?, audio? })` — an explicit value always wins over inference.

## Structured output

When the agent passes `responseSchema` (a JSON Schema object), the adapter converts to `response_format: json_schema, strict: true` on the wire — token-level enforcement. Non-object schemas fall back to loose `json_object` mode (still valid JSON, no shape enforcement).

Some targets reject strict `json_schema` (older OpenAI models, OpenRouter routes, Ollama OpenAI-compat). Override the wire mode per model with `responseFormat`:

```ts
openai.model({ name: "legacy-model", responseFormat: "json_object" }); // valid JSON, no strict shape
openai.model({ name: "some-route", responseFormat: "text" }); // no response_format on the wire
```

`"json_object"` and `"text"` also flip `structuredOutput` to `false`, so the agent re-injects the schema as a soft prompt hint. Pin `structuredOutput` explicitly to override that.

## Multipart messages (image / PDF / audio input)

`ContentPart[]` user content maps per modality to OpenAI's real wire parts:

- `{ type: "text" }` → `{ type: "text", text }`
- `{ type: "image", source: { url } }` → `{ type: "image_url", image_url: { url } }`
- `{ type: "image", source: { base64, mediaType } }` → `{ type: "image_url", image_url: { url: "data:{mediaType};base64,{base64}" } }`
- `{ type: "pdf", source: { base64, mediaType } }` → `{ type: "file", file: { filename, file_data: "data:{mediaType};base64,…" } }` — requires `.model({ pdf: true })`
- `{ type: "audio", source: { base64, mediaType } }` → `{ type: "input_audio", input_audio: { data, format: "wav" | "mp3" } }` — requires `.model({ audio: true })`

PDF and audio reach the wire only when the model declares the matching capability — the agent's modality gate throws otherwise, so capability ≡ behavior. A remote-URL pdf/audio source raises a typed `InvalidRequestError` (OpenAI has no remote file/audio source); an unsupported audio media type does too (only `wav` / `mp3`). The agent prepares attachments before they reach the adapter; this package never reads files itself.

## Image generation (`gpt-image` / DALL·E)

`openai.image({ name })` returns an `ImageModelContract` for the `ai.image()` verb:

```ts
const gpt = openai.image({ name: "gpt-image-1", pricing: { input: 5, output: 40 } }); // token-metered
const dalle = openai.image({ name: "dall-e-3", pricing: { perImage: 0.04 } }); // per-image

const { data } = await ai.image({ model: gpt, prompt: "a red bicycle", size: "1024x1024" });
```

- `gpt-image-*` is token-metered (price with `{ input, output }`) and always returns base64 bytes — the adapter never sends `response_format` (the API rejects it).
- `dall-e-*` is per-image (price with `{ perImage }` / `perImageBySize`); defaults to base64, opt into a hosted URL with `options: { responseFormat: "url" }`.
- The model id is **not validated locally** — `openai.image({ name })` passes it straight to `client.images.generate`, so an id OpenAI does not serve fails at the provider (wrapped into the typed `AIError` hierarchy), not at construction. Same for `openai.speech({ name })` and `openai.transcribe({ name })`. There are no model-id helpers to consult: `isOpenAIImageModel()`, `OPENAI_IMAGE_MODEL_PREFIXES`, `isOpenAISpeechModel()` and `isOpenAITranscriptionModel()` were all removed in 4.13.0 — branch on your own id list if you need one. The verb surface (envelope, options, cost-truth) lives in the `generate-images` topic of the `warlock-js-ai` skill.

## Streaming

`model.stream()` drains `chat.completions.create({ stream: true })` and yields `{ type: "delta", content }` per token, then — after the stream closes — one consolidated `{ type: "tool-call", id, name, input }` per requested tool, then a terminal `{ type: "done", finishReason, usage }`. `stream_options: { include_usage: true }` is enabled by default.

Tool-call argument fragments arrive split across deltas; the adapter accumulates them per `tool_calls[n].index` and parses the assembled JSON once on completion, so streamed tool calls round-trip identically to non-streaming `complete()`. Accumulators that never received a function name are skipped.

Opt-in chunks (`options.streamChunks`, set by `agent.stream()`): Chat yields `{ type: "tool-args", callId, name, delta }` per argument fragment and `{ type: "reasoning", delta }` for a compatible vendor's `delta.reasoning_content` (DeepSeek) / `delta.reasoning` (Groq); Responses yields `reasoning` for `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` (summaries need `body: { reasoning: { summary: "auto" } }`) and `tool-args` for `response.function_call_arguments.delta`. No `usage` chunk (usage arrives at the end).

## Provider-defined tools

With `api: "responses"`, `ai.providerTool({ provider: "openai", definition })` appends hosted tools verbatim (`{ type: "web_search" }`, `file_search`, `code_interpreter`, `image_generation`, `mcp`). Hosted-call items are not replayed (`store: false`), and a reasoning item that led into one is dropped from the replay. Client-run built-ins (`shell_call`, `apply_patch_call`, `computer_call`, `custom_tool_call`, `local_shell_call`, `mcp_approval_request`) throw `InvalidRequestError`. On Chat Completions a provider tool is sent only when `provider` equals the model's provider label (e.g. Groq `{ type: "browser_search" }` with `provider: "groq"`).

```ts
const model = openai.model({ name: "gpt-5.6", api: "responses" });
ai.agent({
  model,
  tools: [ai.providerTool({ provider: "openai", definition: { type: "web_search" } }), lookupOrder],
});
```

## Embeddings

```ts
const embedder = openai.embedder({ name: "text-embedding-3-small" });

const { vector, dimensions, usage } = await embedder.embed("Hello world");
const { vectors } = await embedder.embedMany(["doc 1", "doc 2", "doc 3"]);
```

`dimensions` is lazy — starts at `0`, populated from the first response. Pass `dimensions` in config to request output truncation (supported by `text-embedding-3-*`):

```ts
openai.embedder({ name: "text-embedding-3-large", dimensions: 256 });
```

## Reasoning (o-series / gpt-5)

Reasoning models accept a discrete effort knob. The agent passes it through `ModelCallOptions.reasoning`:

```ts
const model = openai.model({ name: "o3-mini" }); // reasoning auto-true
await model.complete(messages, { reasoning: { effort: "high" } }); // → reasoning_effort: "high"
```

- `reasoning.effort` (`"low" | "medium" | "high" | "none"`) maps verbatim to OpenAI's `reasoning_effort` request param.
- `reasoning.maxTokens` has **no Chat Completions equivalent** (it's the Anthropic extended-thinking budget) and is silently ignored here.
- When `capabilities.reasoning` is `false` (e.g. `gpt-4o`), the option is dropped — the adapter never forwards `reasoning_effort` to a model that would 400 on it. Pin `reasoning: true` to force it for a custom/fine-tuned reasoning model.

### `effort: "none"` — reasoning off, tools on (DEFAULTS automatically)

gpt-5 / o-series models **reject function tools** on the Chat Completions API while reasoning is active — on some model generations this silently degrades to empty replies, on newer ones it's a hard 400:

```
400 — Function tools with reasoning_effort are not supported for <model>
in /v1/chat/completions. To use function tools, use /v1/responses or set
reasoning_effort to 'none'.
```

Since there is no working alternative to `"none"` in that state, the adapter defaults to it automatically: whenever a call is made to a reasoning-capable model WITH `tools` AND the caller supplied no `reasoning.effort` at all, `reasoning_effort: "none"` is emitted for you — no opt-in required.

```ts
const model = openai.model({ name: "gpt-5-mini" }); // reasoning auto-true
await model.complete(messages, { tools }); // → reasoning_effort: "none", automatically
```

An explicit `reasoning.effort` always overrides the default, in either direction — pass it yourself if you want a different value (and accept that tools may then be rejected, per the error above, since Chat Completions still can't do reasoning + tools together):

```ts
await model.complete(messages, { tools, reasoning: { effort: "high" } }); // your choice wins — reasoning stays on, tools may 400
await model.complete(messages, { tools, reasoning: { effort: "none" } }); // same effect as the default, explicit
```

The gpt-6 models (`gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna`) are hard-400 cases, verified live on `gpt-6-sol`:

```
400 Function tools with reasoning_effort are not supported for gpt-6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.
```

Tools work with reasoning off (the adapter's default when tools are present and no reasoning is set). For reasoning **and** tools together, use the Responses API below.

Calling **without** `tools` is unaffected — `reasoning_effort` is still omitted by default in that case (provider default reasoning, nothing to unblock). Trade-off of the `"none"` default: you lose reasoning on that call. For tool-heavy agent work (function calls + good replies rather than deep analysis) this is the right call — it's the difference between empty replies and working ones. When you need reasoning **and** tools together, use the Responses API (next section).

### Reasoning + tools: the Responses API (`api: "responses"`)

Opt a direct-OpenAI model into `/v1/responses`, where reasoning models accept function tools with reasoning on:

```ts
const model = openai.model({ name: "gpt-6-sol", api: "responses" });
await model.complete(messages, { tools, reasoning: { effort: "high" } }); // reasoning stays on, tools work
```

- Chat Completions stays the default; nothing changes unless you pass `api: "responses"`.
- Only the direct `openai` provider accepts it. `@warlock.js/ai-deepseek`, `ai-groq`, `ai-xai` and `ai-mistral` (which reuse this adapter with their own `baseURL`) reject `api: "responses"` with `InvalidRequestError`.
- With tools attached, reasoning uses the provider default instead of being forced to `"none"`: expect more reasoning tokens and latency than the Chat path. Pass `reasoning: { effort }` to choose.
- The system prompt is sent as `instructions`; requests use `store: false` (no server-side conversation state).
- Reasoning is carried across a tool loop without server storage: each response asks for encrypted reasoning, which rides on the first tool call of the turn (`providerMetadata.openaiResponses`) and is sent back on the next request when the model is the same. It is persisted with your conversation history.
- `complete()` and `stream()` both work; streamed chunks follow the same order as the Chat path (deltas, then tool calls, then `done`). Usage reports `reasoningTokens` and `cachedTokens` the same way.
- `pdf` and `audio` inputs are not available on this path.

## Token usage — what's reported

`usage` on the result carries the neutral channel breakdown, populated from OpenAI's `usage` block:

| `Usage` field                | OpenAI source                                          | Notes                                                                                                  |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `input` / `output` / `total` | `prompt_tokens` / `completion_tokens` / `total_tokens` | always present (zeroed if OpenAI omits the block).                                                     |
| `inputIncludesCache`         | — (always `true`)                                      | `prompt_tokens` already contains the cached and cache-written tokens; cost bills them out of it once.  |
| `cachedTokens`               | `prompt_tokens_details.cached_tokens`                  | subset of `input` served from OpenAI's automatic prompt cache. Emitted only when > 0.                  |
| `cacheWriteTokens`           | `prompt_tokens_details.cache_write_tokens`             | subset of `input` written to the cache, on the models that charge for writes. Emitted only when > 0.   |
| `reasoningTokens`            | `completion_tokens_details.reasoning_tokens`           | hidden reasoning channel on o-series / gpt-5 (already counted within `output`). Emitted only when > 0. |
| `cost`                       | computed                                               | per-channel USD when the model is priced (see [Pricing](#pricing--built-in-list-prices-and-registry)). |

The detail counters are omitted (not set to `0`) when the provider reports zero, so non-reasoning / uncached calls keep the lean `{ input, output, total, inputIncludesCache }` shape. Reported identically on `complete()`, the streaming `done` event and the Responses API (`input_tokens_details.cached_tokens` / `cache_write_tokens`). The OpenAI-compatible wrappers (DeepSeek, xAI, Groq, Mistral) report the same fields and the same inclusive semantics.

### Explicit prompt caching

Chat Completions exposes OpenAI-specific cache controls on current SDK types. Configure a stable cache bucket and (when needed) its maximum retention policy per model:

```ts
const model = openai.model({
  name: "gpt-5.6",
  promptCacheKey: "tenant:acme",
  promptCacheRetention: "24h", // or "in_memory"
});
```

`promptCacheKey` improves matching for related requests. `promptCacheRetention` is OpenAI's maximum policy (`"in_memory" | "24h"`). `cacheControl.breakpoints` maps to `prompt_cache_breakpoint: { mode: "explicit" }` on the final user content parts (up to OpenAI's four-request limit); use it when you need to pin a reusable prefix rather than rely only on OpenAI's implicit breakpoint.

Which fields reach the wire depends on the SDK provider label:

| Provider label         | `prompt_cache_key` | `prompt_cache_retention` / explicit breakpoints | Why                                                                                                                                                                 |
| ---------------------- | ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"openai"`             | sent               | sent                                            | https://developers.openai.com/api/docs/guides/prompt-caching                                                                                                        |
| `"xai"`                | sent               | —                                               | xAI Chat Completions accepts `prompt_cache_key` (routed as `x-grok-conv-id`) — https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits |
| `"mistral"`            | sent               | —                                               | https://docs.mistral.ai/studio/conversations/advanced/prompt-caching                                                                                                |
| `"groq"`, `"deepseek"` | —                  | —                                               | both cache automatically and document no request hint                                                                                                               |
| any custom label       | —                  | —                                               | an unknown endpoint may reject the fields                                                                                                                           |

(Checked 2026-10-17.) `XaiSDK` and `MistralSDK` keep their default labels unless you pass `provider`, so `xai.model({ name, promptCacheKey })` works out of the box. Read-side `usage.cachedTokens` accounting remains available whenever the upstream reports it.

## Token counting

```ts
await openai.count("some text"); // approximate (heuristic, not tiktoken)
```

Good enough for budgeting; not for billing.

## Pricing — built-in list prices and registry

All rates are **USD per 1,000,000 tokens** (`ModelPricing`: `input`, `output`, optional `cachedInput`, `cacheWrite`, `cacheWrite1h`, `reasoning`). Resolution at `model()` time: per-model `pricing` (`openai.model({ name, pricing })`) > SDK `pricing` registry > built-in `OPENAI_MODEL_PRICING` (only when the SDK provider label is `"openai"`, exact model id) > `undefined` (no cost computed).

```ts
import { ai, totalCost } from "@warlock.js/ai";
import { OPENAI_MODEL_PRICING, OpenAISDK, openAIPricingFor } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  pricing: {
    // Prompt-length-tiered models have no built-in rate — price them yourself.
    "gpt-5.5": { input: 5, output: 30, cachedInput: 0.5 },
  },
});

openai.model({ name: "gpt-4o-mini" }).pricing; // built-in: { input: 0.15, output: 0.6, cachedInput: 0.075 }
openAIPricingFor("gpt-4o-2024-05-13"); // undefined — dated snapshots can carry other prices
Object.keys(OPENAI_MODEL_PRICING); // the priced ids

const { usage } = await ai.agent({ model: openai.model({ name: "gpt-4o-mini" }) }).execute("hi");
console.log(usage.cost, totalCost(usage.cost)); // per-channel USD breakdown of THIS run, and its sum

// A direct call is costed too — no agent needed.
const side = await openai
  .model({ name: "gpt-4.1-mini" })
  .complete([{ role: "user", content: "Classify: …" }]);
console.log(totalCost(side.usage.cost));
```

- **Source.** `OPENAI_MODEL_PRICING` comes from https://developers.openai.com/api/docs/pricing (the target of platform.openai.com/docs/pricing), Standard tier, fetched 2026-10-17. It covers the flat-priced models: `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1` (+ `-mini` / `-nano`), `gpt-4o`, `gpt-4o-mini`, `o3`, `o4-mini`, `o3-mini`, `o1`. None of them charges for cache writes.
- **Deliberately unpriced:** models priced by prompt length (a higher rate above 272K input tokens — the gpt-6, gpt-5.6, gpt-5.5 and gpt-5.4 families and the `-pro` models), dated snapshot ids, promotional / Batch / Flex / Priority pricing, and the regional data-residency uplift. Wrapper SDKs (`provider` other than `"openai"`) never fall back to this table.

## Errors

Raw OpenAI SDK errors are wrapped into the typed `@warlock.js/ai` `AIError` hierarchy via the adapter's error wrapper. Dispatch keys on `APIError.status + code` combined — see the `handle-ai-errors` topic of the `warlock-js-ai` skill. HTTP 503 and code `server_is_overloaded` (https://developers.openai.com/api/docs/guides/error-codes) map to `ProviderOverloadedError` (`code: "PROVIDER_OVERLOADED"`, `retryable: true`, `retryAfter` from `retry-after`); the compatible wrappers use 503 for the same condition (DeepSeek documents it as "Server Overloaded"). Every wrapped error carries `status`, `retryable` and `billed` — `false` for 401 / 402 / 403, otherwise `"unknown"`, because OpenAI publishes no rule for failed requests.

```ts
import { ai, ProviderOverloadedError } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const result = await ai.agent({ model: openai.model({ name: "gpt-4o-mini" }) }).execute("hi");

if (result.error instanceof ProviderOverloadedError) {
  console.log(result.error.status, result.error.retryAfter); // back off, or fall back to another model
}
```

## Provider body options and input-token counts

Native body fields merge after neutral options. When both values are plain
objects, their immediate keys merge and caller-provided keys win; untouched
neutral fields remain. Arrays, scalars and `null` replace the field. This merge
is one level deep: a nested object explicitly supplied by the caller replaces
that nested value. When both objects have string `type` discriminators and the
caller changes the type, the whole object is replaced. For example, overriding
`response_format` from `json_schema` to `json_object` removes the old
`json_schema` fields; switching `tool_choice` variants removes old variant fields
as well. The rule also applies to OpenAI-compatible adapters using this helper.

`providerOptions.openai.body` adds native request fields to Chat Completions or
Responses, merged after the neutral options. For example:

```ts
const options = { providerOptions: { openai: { body: { service_tier: "default" } } } };
await model.complete(messages, options);
```

The key stays `openai` for compatible gateways with a custom provider label.
Other provider keys are ignored. `OpenAICallOptions` is exported. The body cannot
replace `model`, `messages`, `input`, `instructions`, `tools`, `stream`,
`stream_options`, `previous_response_id`, `conversation`, `store`, `include`, `functions`, `function_call`, `prompt` or `background`;
those fields protect the adapter's conversation, tools and stateless replay.

Models using `api: "responses"` expose native `countTokens(messages, options?)`
through `responses.inputTokens.count`: the same input, system instructions,
tools, reasoning, text format, tool choice, parallel-tool setting and truncation
used for generation are counted. The endpoint supports only input-shaping fields;
output caps and generation-only options are omitted. The Chat Completions model
has no `countTokens` method. `sdk.count(text)` remains a separate offline estimate.

For budget preflight, `countInputTokens(model, messages, { tools })` from
`@warlock.js/ai` returns `{ tokens, source }`. It estimates only when native
counting is absent or explicitly throws `InvalidRequestError` with
`reason: "count-unsupported"`; this adapter preserves that signal. System and
tools are supported natively. Ordinary validation, auth, network and rate-limit
errors propagate. See the cost/budget guide for reserve mode.

```ts
if (model.countTokens) {
  const inputTokens = await model.countTokens(messages, options);
}
```

## When NOT to use this skill

- Direct calls to the `openai` SDK without going through `@warlock.js/ai` agents.
- Anthropic models — use `@warlock.js/ai-anthropic`. Bedrock — `@warlock.js/ai-bedrock`. Gemini — `@warlock.js/ai-google`. Ollama — `@warlock.js/ai-ollama`.

## See also

- The `run-ai-agent` topic of the `warlock-js-ai` skill — passing the model into `ai.agent({...})`
- The `embed-text` topic of the `warlock-js-ai` skill — embedder usage
- The `pick-ai-provider` topic of the `warlock-js-ai` skill — adapter comparison

## Hosted-search metering and metadata

On Responses, each structured `web_search_call` output item contributes one
`usage.serverToolUse.webSearchRequests`. Streaming item events and terminal
output are reconciled as snapshots, so the same call is counted once.
`response.providerMetadata.openai.output` (also on streaming `done`) retains
hosted output items with their action and sources. The adapter automatically
requests `web_search_call.action.sources` when web-search tools are supplied.
Agent reports preserve this metadata on each trip; it is not replayed or
passed to function dispatch.

Explicitly set `pricing.serverTools: OPENAI_SERVER_TOOL_PRICING` (exported by
this package) for standard `web_search`: $0.01 per tool call, plus search-content
tokens at model rates. Non-reasoning `web_search_preview` has a different fee
and needs an explicit override. These prices were verified on 2026-10-18 from
[OpenAI pricing](https://developers.openai.com/api/docs/pricing#built-in-tools);
see the [official search output schema](https://developers.openai.com/api/docs/guides/tools-web-search)
and [cost tracking](https://warlock.js.org/v/latest/ai/recipes/cost-tracking/#hosted-tool-request-fees).
Chat Completions does not map hosted-search billing counters.

Qwen's `enableSearch` flag and Kimi's standalone `kimiSearchTool()` /
`kimiFetchTool()` have separate controls; Kimi's legacy builtin retires on
20 October 2026 and is unsupported; see [OpenAI-compatible native search](https://warlock.js.org/v/latest/ai/providers/openai-compatible/).

```ts
import { OPENAI_SERVER_TOOL_PRICING } from "@warlock.js/ai-openai";
const model = openai.model({
  name: "gpt-4.1",
  api: "responses",
  pricing: { ...{ input: 2, output: 8 }, serverTools: OPENAI_SERVER_TOOL_PRICING },
});
const response = await model.complete(messages, {
  providerTools: [{ provider: "openai", definition: { type: "web_search" } }],
});
console.log(response.usage.serverToolUse?.webSearchRequests);
console.log(response.providerMetadata);
```

## Kimi first-party search and fetch

Use the same API key/base URL configuration for the model and client tools:

```ts
import { ai, createToolContext } from "@warlock.js/ai";
import { OpenAISDK, kimiSearchTool, kimiFetchTool } from "@warlock.js/ai-openai";

const config = {
  apiKey: process.env.MOONSHOT_API_KEY ?? "",
  baseURL: "https://api.moonshot.ai/v1",
};
const sdk = new OpenAISDK({ ...config, provider: "moonshot" });
const basic = kimiSearchTool({ ...config, includeContent: false });
const pro = kimiSearchTool({
  ...config,
  mode: "pro",
  sites: ["moonshot.ai"],
  timeWindow: { start: "2026-01", end: "2026-10" },
  limit: 5,
  timeoutSeconds: 30,
});
const fetchPage = kimiFetchTool({ ...config, maxContentChars: 12_000 });
const assistant = ai.agent({ model: sdk.model({ name: "kimi-k3" }), tools: [pro, fetchPage] });
const result = await assistant.execute("Research prompt caching");
console.log(result.usage.serverToolUse, result.usage.cost?.serverTools);

const controller = new AbortController();
const found = await basic.invoke(
  { query: "Kimi prompt caching" },
  createToolContext({ signal: controller.signal }),
);
console.log(found.data?.results, found.usage);
```

Pass these functions directly as ordinary `tools`, without `ai.providerTool`.
They call `/v1/tools/search`, `/v1/tools/search_pro` or `/v1/tools/fetch` with
Bearer auth. Search arguments are `{ query }`; fetch arguments are `{ url }`.
Search results retain sources and optional full text (Basic) or scored chunks
(Pro); fetch returns Markdown. Text is bounded by `maxContentChars` (12,000 by
default), with `truncated` reporting trimming. `limit` is 1–20; timeoutSeconds
is 1–60; Pro accepts up to five sites and date filters. See
https://platform.kimi.ai/docs/api/tools-search,
https://platform.kimi.ai/docs/api/tools-search-pro and
https://platform.kimi.ai/docs/api/tools-fetch.

Use `invoke()` for the usage/report envelope. Per response, billable Basic,
Pro and Fetch units appear as `kimiSearchRequests`, `kimiSearchProRequests`
and `kimiFetchRequests`, alongside common search/fetch counters. Agents merge
these into their totals. `KIMI_SERVER_TOOL_PRICING` supplies the default rates
in `ModelPricing.serverTools` format; only namespaced keys are priced to avoid
double charges. Override `pricing` or pass `{}` to leave calls unpriced.
Official prices verified 2026-10-18: $0.002 / $0.003 / $0.002 respectively,
excluding taxes, only for HTTP 200 with nonempty search results/nonblank
Markdown: https://platform.kimi.ai/docs/pricing/websearch.

The legacy `$web_search` builtin retires on 20 October 2026 and is rejected.
Abort signals cancel transport; retries are disabled. `invoke().error` is a
`ToolExecutionError` whose `cause` is the mapped provider error (or
`AgentCancelledError` for caller cancellation). `execute()` returns data only
and throws mapped errors. Never infer fees from function calls or prose.
