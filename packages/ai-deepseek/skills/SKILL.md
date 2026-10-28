---
name: warlock-js-ai-deepseek
description: 'DeepSeek adapter for Warlock AI: `DeepSeekSDK`, `DEEPSEEK_CHAT_MODELS`, `DEEPSEEK_DEFAULT_PRICING` and `DEEPSEEK_OFF_PEAK_PRICING`. Use for "connect DeepSeek", reasoning, streaming, tools, capability inference or per-model pricing through `sdk.model()`. Not this package → @warlock.js/ai for agents, tools and workflows; @warlock.js/ai-openai for generic OpenAI-compatible endpoints.'
---

# `@warlock.js/ai-deepseek`

Provider adapter for DeepSeek. DeepSeek's API is **OpenAI-compatible**, so this package is a **thin wrapper** over `@warlock.js/ai-openai`'s `OpenAISDK` (the `warlock-js-ai-openai` skill): it constructs an internal `OpenAISDK` pinned to `https://api.deepseek.com` with `provider: "deepseek"` and delegates `model()` / `embedder()` / `image()` / `count()` to it — while injecting DeepSeek's own capability inference and pricing so the right flags are set even though the model names aren't OpenAI names. Pair with `@warlock.js/ai` for the agent / tool / system-prompt surface.

## Construction

```ts
import { DeepSeekSDK } from "@warlock.js/ai-deepseek";

const deepseek = new DeepSeekSDK({ apiKey: process.env.DEEPSEEK_API_KEY! });
```

`apiKey` is the only required field — `baseURL` defaults to `https://api.deepseek.com` (DeepSeek's OpenAI-compatible endpoint) and `provider` defaults to `"deepseek"`. Override `baseURL` only for a proxy/gateway, or `provider` to relabel the upstream:

```ts
new DeepSeekSDK({ apiKey, baseURL: "https://my-gateway/deepseek", provider: "deepseek-proxy" });
```

`DeepSeekSDK` is a class (like `OpenAISDK`) holding one long-lived wrapped client — construct once per account and reuse.

## Producing a model

```ts
deepseek.model({ name: "deepseek-chat" }); // V3 lineage, non-thinking
deepseek.model({ name: "deepseek-reasoner" }); // R1 lineage, reasoning-capable
deepseek.model({ name: "deepseek-chat", temperature: 0.2 });
```

Returns a `ModelContract` you pass straight into `ai.agent({ model })`.

## Models

| Model               | Notes                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `deepseek-chat`     | Non-thinking surface (V3 lineage). Fast, cheap, broad coverage. Reasoning **off**. |
| `deepseek-reasoner` | Thinking surface (R1 lineage). Emits a reasoning channel. Reasoning **on**.        |
| `deepseek-v4-flash` | Newer flash tier. Reasoning **off** by default.                                    |
| `deepseek-v4-pro`   | Newer quality tier. Reasoning **on** by default.                                   |

DeepSeek announced the legacy `deepseek-chat` / `deepseek-reasoner` names retire 2026/07/24 in favor of the `deepseek-v4-*` family; both name sets are understood by the capability inference. `deepseek.model({ name })` accepts any id the upstream serves.

## Capabilities — what's auto-set

| Flag               | Default                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoning`        | Inferred from the DeepSeek model name. `true` for `deepseek-reasoner` and the `*-pro` tier; `false` for `deepseek-chat` / `*-flash`. Drives whether the reasoning-effort knob is forwarded. |
| `vision`           | `false` for every DeepSeek model — no DeepSeek chat model documents image input (mid-2026).                                                                                                 |
| `structuredOutput` | `true` (inherited from the wrapped OpenAI model), unless `responseFormat` is set to a loose mode.                                                                                           |
| `promptCaching`    | `true` (inherited). DeepSeek reports cache hits via `usage.cachedTokens`, the same shape as OpenAI.                                                                                         |

**Override any flag explicitly** via `.model({ name, reasoning?, vision?, structuredOutput? })` — an explicit value always wins over the injected inference.

```ts
deepseek.model({ name: "deepseek-chat", reasoning: true }); // force thinking flag
deepseek.model({ name: "deepseek-reasoner", reasoning: false }); // suppress it
```

## Uses the OpenAI-compatible endpoint

Everything on the wire — Chat Completions request/response shape, streaming loop, tool-call accumulation, structured-output `response_format`, multipart message mapping, and error wrapping — is inherited **unchanged** from `OpenAIModel`. See the `warlock-js-ai-openai` skill for the wire-level detail; it all applies here against `https://api.deepseek.com`.

Structured output, reasoning effort, and streaming therefore behave exactly as documented for the OpenAI adapter:

```ts
const model = deepseek.model({ name: "deepseek-reasoner" }); // reasoning auto-true
await model.complete(messages, { reasoning: { effort: "high" } }); // → reasoning_effort: "high"
```

## Embeddings & images

`deepseek.embedder({...})` and `deepseek.image({...})` delegate to the wrapped `OpenAISDK`. **DeepSeek does not officially document an OpenAI-compatible embeddings endpoint or an image-generation endpoint (mid-2026)** — these delegates exist for adapter parity and work against a compatible gateway you point `baseURL` at, but may fail against the stock DeepSeek endpoint. Use a dedicated embeddings provider (e.g. `@warlock.js/ai-openai` / `@warlock.js/ai-google`) for RAG.

## Pricing

The adapter ships **built-in DeepSeek pricing defaults** (`DEEPSEEK_DEFAULT_PRICING`, USD per 1M tokens; `cachedInput` is the cache-hit rate), so `usage.cost` is computed out of the box — on agent reports and on each `model.complete()` / streaming `done` usage.

DeepSeek bills by time of day: peak hours (01:00–04:00 and 06:00–10:00 UTC, Monday to Friday) cost twice the off-peak rate. A flat `ModelPricing` cannot follow the clock, so the defaults are the **peak** rates — an upper bound that keeps USD budgets safe; off-peak calls really cost half. Opt into `DEEPSEEK_OFF_PEAK_PRICING` when you know you run off-peak.

```ts
import { totalCost } from "@warlock.js/ai";
import {
  DEEPSEEK_DEFAULT_PRICING,
  DEEPSEEK_OFF_PEAK_PRICING,
  DeepSeekSDK,
} from "@warlock.js/ai-deepseek";

const deepseek = new DeepSeekSDK({ apiKey: process.env.DEEPSEEK_API_KEY ?? "" });
DEEPSEEK_DEFAULT_PRICING["deepseek-flash"]; // { input: 0.3, output: 1.2, cachedInput: 0.006 } — peak

const offPeak = new DeepSeekSDK({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  pricing: DEEPSEEK_OFF_PEAK_PRICING, // { input: 0.15, output: 0.6, cachedInput: 0.003 } for flash
});

const { usage } = await offPeak
  .model({ name: "deepseek-v4-pro" })
  .complete([{ role: "user", content: "hi" }]);
console.log(usage.cachedTokens, totalCost(usage.cost));
```

Resolution at `model()` time: per-model `pricing` > SDK `pricing` registry > built-in DeepSeek default > `undefined`.

- **Source.** https://api-docs.deepseek.com/quick_start/pricing, fetched 2026-10-17. Covered: `deepseek-flash`, `deepseek-v4-flash` (its legacy name, same rate) and `deepseek-v4-pro`.
- **Unpriced:** `deepseek-chat` / `deepseek-reasoner` are gone from the price list (announced for discontinuation on 2026-07-24) — pass `pricing` if a gateway still serves them.
- **Usage semantics.** DeepSeek's `prompt_tokens` equals cache hits + misses and `prompt_tokens_details.cached_tokens` mirrors `prompt_cache_hit_tokens`, so the usage is `inputIncludesCache: true` and hits bill at `cachedInput`. DeepSeek caches automatically on disk and takes no request hint, so `promptCacheKey` is never sent.

## Errors

Raw errors surface through the wrapped OpenAI adapter's wrapper into the typed `@warlock.js/ai` `AIError` hierarchy — see the `handle-ai-errors` topic of the `warlock-js-ai` skill. DeepSeek documents 503 as "Server Overloaded" (https://api-docs.deepseek.com/quick_start/error_codes); it maps to `ProviderOverloadedError` (`code: "PROVIDER_OVERLOADED"`, `retryable: true`). Every wrapped error carries `status`, `retryable` and `billed` (`false` for 401 / 402 / 403, otherwise `"unknown"`).

## When NOT to use this skill

- OpenAI / Azure OpenAI / OpenRouter / local OpenAI-compatible gateways — use `@warlock.js/ai-openai`.
- Anthropic — `@warlock.js/ai-anthropic`. Gemini — `@warlock.js/ai-google`. Ollama — `@warlock.js/ai-ollama`.
- Calling the DeepSeek HTTP API or the raw `openai` SDK directly without going through `@warlock.js/ai` agents.

## See also

- The `warlock-js-ai-openai` skill — the wrapped adapter; all wire-level behavior.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — passing the model into `ai.agent({...})`.
- The `pick-ai-provider` topic of the `warlock-js-ai` skill — adapter comparison.

## Provider body options and token estimates

This adapter delegates Chat Completions to the OpenAI adapter, so
`providerOptions.openai.body` adds native Chat request fields. Other provider
keys are ignored. Plain-object fields merge one level deep with neutral options;
caller-provided keys win, while arrays, scalars and `null` replace the field.
The OpenAI adapter's protected conversation, tool and transport fields remain
protected here too. Send only fields supported by this provider; do not reuse
OpenAI-only bodies across a mixed-provider fallback chain.

Models from this adapter have no native `countTokens` method. Check
`model.countTokens` before using an optional native counting capability;
`sdk.count(text)` is a separate offline estimate.

## List models

`await deepseek.models()` returns `ModelInfo[]` from `GET /models`.
