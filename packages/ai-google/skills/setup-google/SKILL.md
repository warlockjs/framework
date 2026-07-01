---
name: setup-google
description: 'Wire @warlock.js/ai-google — new GoogleSDK({apiKey} | {vertexai, project, location}) for Gemini API + Vertex AI. generateContent / embedContent + thoughtSignature round-trip for thinking models, batched embeddings. .model({name, vision?, reasoning?, audio?, pdf?}) with cost-truth capabilities (PDF + audio input map to Gemini inlineData), .image({name, pricing?}) for Imagen (imagen-*) image generation via ai.image, extended thinking via options.reasoning → thinkingConfig.thinkingBudget, usage reasoningTokens (thoughtsTokenCount) / cachedTokens (cachedContentTokenCount). Triggers: `GoogleSDK`, `google.model`, `google.embedder`, `google.image`, `imagen`, `generateImages`, `ai.image`, `inlineData`, `pdf input`, `audio input`, `thoughtSignature`, `responseJsonSchema`, `vertexai`, `reasoning`, `thinkingConfig`, `thinkingBudget`, `thoughtsTokenCount`, `reasoningTokens`, `cachedTokens`, `promptCaching`, `cacheControl`; "use gemini", "wire Vertex AI", "gemini embeddings", "gemini thinking tool calls", "gemini 2.5 thinking budget", "gemini cached content cost", "generate images with imagen", "send a pdf / audio to gemini"; import `import { GoogleSDK } from "@warlock.js/ai-google"`. Skip: the ai.image verb surface — `@warlock.js/ai/generate-images/SKILL.md`; agent loop `@warlock.js/ai/run-ai-agent/SKILL.md`; provider picking `@warlock.js/ai/pick-ai-provider/SKILL.md`; embedder usage `@warlock.js/ai/embed-text/SKILL.md`; siblings `@warlock.js/ai-openai`, `@warlock.js/ai-anthropic`, `@warlock.js/ai-bedrock`, `@warlock.js/ai-ollama`; raw `@google/genai`, `@google-cloud/vertexai`, Vercel `@ai-sdk/google`.'
---

# `@warlock.js/ai-google`

Provider adapter that turns Google Gemini into a vendor-neutral `ModelContract`, plus a Gemini embedder. Mirrors the openai / anthropic / bedrock adapters.

## Construction

```ts
import { GoogleSDK } from "@warlock.js/ai-google";

// Gemini API (API key):
const google = new GoogleSDK({ apiKey: process.env.GEMINI_API_KEY! });

// Vertex AI:
const vertex = new GoogleSDK({
  vertexai: true,
  project: "my-project",
  location: "us-central1",
  provider: "vertex",
});
```

`GoogleSDK` is a class with a long-lived `GoogleGenAI` client. The two adapter-only keys (`provider`, `pricing`) are stripped; everything else is forwarded verbatim to `new GoogleGenAI(...)` (so `apiVersion`, `httpOptions`, `vertexai`, `project`, `location` all pass through). `provider` defaults to `"google"`.

## Producing a model

```ts
google.model({ name: "gemini-2.5-flash" })
google.model({ name: "gemini-2.5-pro", temperature: 0.2 })
google.model({ name: "gemini-1.5-flash", maxTokens: 2048 })
```

## Capabilities — what's auto-set

| Flag | Default |
| --- | --- |
| `structuredOutput` | `true` (via `responseMimeType` + `responseJsonSchema`) |
| `vision` | Inferred from model id substring. `true` when the id contains `gemini-1.5`, `gemini-2` (covers 2.x / 2.5), `gemini-exp`, `gemini-flash`, or `gemini-pro-vision`; `false` for bare `gemini-pro` / `gemini-1.0-pro` and any unknown id. Case-insensitive, tolerates date/preview/vendor-prefix suffixes (`models/gemini-1.5-flash-001`). |
| `reasoning` | `true` — every Gemini 2.5 model thinks; older families harmlessly ignore an empty budget. Set `reasoning: false` to stop forwarding `thinkingConfig` to a model that rejects it. |
| `promptCaching` | Always `true` — Gemini reports cache-read hits (`cachedContentTokenCount`) via implicit caching and accepts explicit context caching. |
| `audio` | Mirrors the `vision` inference (the multimodal Gemini families accept audio parts). Override with `audio: true \| false`. |
| `pdf` | Mirrors the `vision` inference (the multimodal Gemini families accept PDF / document parts). Override with `pdf: true \| false`. |

Explicit config always wins (`google.model({ name, reasoning: false, audio: false, pdf: true })`).

## System prompt

Gemini content roles must be `"user"` or `"model"` — there is no `"system"` role. The adapter hoists every neutral `role: "system"` message into the separate `config.systemInstruction` string. Transparent to the agent.

## Roles & tool calls

- Neutral `assistant` → Gemini `"model"`; `user` stays `"user"`.
- Assistant tool calls → `"model"` content: optional leading `{ text }` + one `{ functionCall: { name, args } }` part per call (`id` deliberately omitted — see below).
- Tool results (`role: "tool"`) → a `"user"` content with one `{ functionResponse: { name, response } }` part. `response` must be a JSON object, so a stringified-JSON tool result is parsed back to an object; a non-object result is wrapped as `{ result: <raw> }`.

**Gemini matches a result to its call by name, not id** — the Developer API assigns no function-call ids. The adapter sets neutral `id` = tool name so `toolCallId` is non-empty. The wire `id` is omitted from both `functionCall` and `functionResponse` (echoing an empty/synthetic id is rejected by Gemini). **Limitation:** two parallel calls to the same tool in one turn share an id — inherent to the Developer API's id-less design.

**Gemini reports `finishReason: STOP` even when it called a function** — the adapter overrides to `"tool_calls"` when the response carries function calls.

**`thoughtSignature` round-trip (thinking models).** Gemini 2.5 thinking models attach an opaque `thoughtSignature` to each `functionCall` part and **400 the next request** if it's not echoed back. The adapter captures the signature into `ModelToolCallRequest.providerMetadata.thoughtSignature` and replays it on the echoed `functionCall` part. Fully automatic.

## Structured output

Object-root `responseSchema` + `structuredOutput`-capable → `config.responseMimeType = "application/json"` + `config.responseJsonSchema = <schema>` (Gemini takes a **raw JSON Schema** directly, not its typed `Schema`).

## Multipart messages (image / PDF / audio input)

Gemini's multimodal input is **media-agnostic** — every binary modality maps to one `inlineData` block keyed by IANA mime type:

- `{ type: "text" }` → `{ text }`
- `{ type: "image", source: { base64, mediaType } }` → `{ inlineData: { mimeType, data } }`
- `{ type: "pdf", source: { base64, mediaType: "application/pdf" } }` → `{ inlineData: { mimeType: "application/pdf", data } }` (gated on `capabilities.pdf`)
- `{ type: "audio", source: { base64, mediaType: "audio/mpeg" } }` → `{ inlineData: { mimeType: "audio/mpeg", data } }` (gated on `capabilities.audio`)
- any `{ source: { url } }` → **throws `InvalidRequestError`** naming the modality. `generateContent` does not fetch arbitrary remote URLs (only Files API / GCS URIs). Resolve to base64 first.

PDF and audio reach the wire only when the model declares the matching capability (inferred for the multimodal Gemini families above) — so capability ≡ behavior.

## Image generation (Imagen)

`google.image({ name })` returns an `ImageModelContract` (Imagen, via `ai.models.generateImages`) for the `ai.image()` verb:

```ts
const imagen = google.image({ name: "imagen-4.0-generate-001", pricing: { perImage: 0.04 } });

const { data, error } = await ai.image({
  model: imagen,
  prompt: "a watercolor lighthouse at dawn",
  aspectRatio: "3:4",          // Imagen ratio (vs OpenAI's WxH `size`)
  negativePrompt: "text, watermark",
  options: { imageSize: "2K", personGeneration: "allow_adult" }, // Imagen passthroughs
});
```

- Imagen is **per-image-metered** (price with `{ perImage }`) and returns base64 bytes — no hosted URL, no token usage.
- When every candidate is safety-filtered, the run surfaces a typed `ContentFilterError` on `result.error`.
- A non-Imagen model id (`google.image({ name: "gemini-2.5-flash" })`) throws `InvalidRequestError` at construction — Gemini's *native* image output (`gemini-*-image` via `generateContent`) is a separate surface, not routed here. The verb surface lives in [`@warlock.js/ai/generate-images/SKILL.md`](@warlock.js/ai/generate-images/SKILL.md).

## Streaming

`model.stream()` drains `generateContentStream`. Each chunk's `.text` → `{ type: "delta" }`; `functionCall` parts (read from `candidates[0].content.parts`, not the `.functionCalls` getter — the getter drops `thoughtSignature`) are emitted as `{ type: "tool-call" }` **fully formed** (Gemini streams a complete call with parsed `args`, not partial JSON), carrying `providerMetadata.thoughtSignature` when present. Terminal `{ type: "done", finishReason, usage }` — usage from the final chunk's `usageMetadata`.

## Finish-reason mapping

`STOP` → `stop` · `MAX_TOKENS` → `length` · `SAFETY` / `RECITATION` / `BLOCKLIST` / `PROHIBITED_CONTENT` / `MALFORMED_FUNCTION_CALL` / unknown / null → `error`. `tool_calls` is derived from function-call presence.

## Embeddings

```ts
const embedder = google.embedder({ name: "gemini-embedding-001" });
const { vector } = await embedder.embed("Hello world");
const { vectors } = await embedder.embedMany(["a", "b"]);   // single batched call
```

`embedContent` accepts an array natively, so `embedMany` is **one request** (unlike Bedrock/Titan). Pass `dimensions` to forward Gemini's `outputDimensionality` truncation hint.

**Gemini's embed endpoint returns no token usage**, so `usage` is always `{ promptTokens: 0, totalTokens: 0 }` (honest absence).

## Errors

Wrapped into the typed `@warlock.js/ai` `AIError` hierarchy. Gemini has no machine error code — dispatch keys on HTTP `status` + canonical status phrase in the message:

- 401/403 / `PERMISSION_DENIED` / "API key not valid" → `ProviderAuthError`
- 429 / `RESOURCE_EXHAUSTED` → `ProviderRateLimitError`
- 400 with token/context phrasing → `ContextLengthExceededError`, else `InvalidRequestError`
- 404 / any other 4xx → `InvalidRequestError`
- 504 / `DEADLINE_EXCEEDED` / `ETIMEDOUT` / `ECONNABORTED` / `AbortError` → `ProviderTimeoutError`
- anything else (5xx and status-less) → `ProviderError`

Timeout is checked first, so an aborted/`AbortError` request always classifies as `ProviderTimeoutError` regardless of status. `AIError` instances pass through unwrapped (no double-wrap).

## Token counting

```ts
await google.count("some text")  // approximate heuristic, offline
```

`count(text, model?)` accepts an optional model arg for signature parity but **ignores it** — the estimate is `approximateTokenCount` (≈ `ceil(chars / 4)`) from `@warlock.js/ai`, never a `countTokens` network call.

## Reasoning / thinking

For `reasoning`-capable models, `ModelCallOptions.reasoning` maps to Gemini's `config.thinkingConfig`:

- `reasoning.maxTokens` → `thinkingConfig.thinkingBudget` (direct token cap on the thinking phase).
- `reasoning.effort` (when no `maxTokens`) → a bucketed budget: `low` → 1024, `medium` → 8192, `high` → 24576. Explicit `maxTokens` always wins over `effort`.
- Nothing is emitted when `reasoning` is absent, carries neither field, or the model's `reasoning` capability is `false` — a non-thinking model never receives an unsupported `thinkingConfig`.

Gemini's `thinkingBudget` semantics (for direct `maxTokens` use): `0` disables thinking, `-1` is automatic, a positive value caps thinking tokens.

## Prompt caching

`capabilities.promptCaching` is `true`: the read side (`Usage.cachedTokens` from `cachedContentTokenCount`) is always honored, covering Gemini's implicit auto-caching and explicit context caches. `ModelCallOptions.cacheControl.breakpoints` is accepted but a **graceful no-op** — the Gemini `generateContent` request has no per-call cache-write breakpoint marker (unlike Anthropic's `cache_control`); explicit caching is configured out-of-band via a `cachedContent` resource. Read accounting works regardless.

## Token usage

`complete()` / `stream()` map Gemini's `usageMetadata` into the neutral `Usage` (`{ input, output, total }`): `promptTokenCount` → `input`, `candidatesTokenCount` → `output`, `totalTokenCount` → `total` (falling back to `input + output` when absent). `cachedContentTokenCount`, when > 0, is surfaced as `usage.cachedTokens`; `thoughtsTokenCount` (a reasoning model's thinking-phase tokens), when > 0, as `usage.reasoningTokens`. Both are omitted when zero/absent. Embeddings have no usage (see above).

## Pricing

Optional USD pricing flows in two ways, resolved per `model()` call:

```ts
// SDK-level registry, keyed by model name:
const google = new GoogleSDK({
  apiKey,
  pricing: { "gemini-2.5-flash": { input: 0.3, output: 2.5 } },
});

google.model({ name: "gemini-2.5-flash" });               // → inherits the registry entry
google.model({ name: "gemini-2.5-flash", pricing: {...} }); // → per-model pricing wins
google.model({ name: "gemini-2.5-pro" });                  // → no entry → pricing undefined (no cost computed)
```

Resolution order: per-model `pricing` > SDK-level registry entry > `undefined`. The resolved `ModelPricing` is attached to the produced model so the agent runtime can compute cost from usage.

## When NOT to use this skill

- Direct `@google/genai` calls without going through `@warlock.js/ai` agents.
- OpenAI / Anthropic / Bedrock / Ollama models — those have their own adapter packages.

## See also

- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md)
- [`@warlock.js/ai/pick-ai-provider/SKILL.md`](@warlock.js/ai/pick-ai-provider/SKILL.md)
- [`@warlock.js/ai/embed-text/SKILL.md`](@warlock.js/ai/embed-text/SKILL.md)
