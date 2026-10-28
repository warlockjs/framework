# Changelog — @warlock.js/ai-openai

All notable changes to `@warlock.js/ai-openai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.40.0 - 2026-10-28

### Added

- `openai.models()` lists the models the key can use from `GET /models` as `ModelInfo[]`, following pagination. Works on OpenAI-compatible gateways too, with the SDK's provider label. Groq's `context_window` and `active`, Mistral's `name`, `description`, `max_context_length` and `capabilities`, and `created_at` dates are read when present.
- `OpenAIResponsesModel` is exported, and `OpenAISDK.compatibleResponses()` builds it for vendor packages that serve `/v1/responses` (used by the xAI adapter). That mode sends `store: false` and leaves out the OpenAI-only `include` fields.

### Changed

- On the direct `"openai"` provider, a call that carries the hosted `web_search` tool (or its dated and `_preview` variants) is now served by the Responses API automatically instead of failing with a 400 on Chat Completions. Calls without it stay on Chat Completions.
- Hosted `web_search` now fails with a clear `InvalidRequestError`, before any request, on models OpenAI documents as unable to search (`gpt-3.5*`, `gpt-4`, `gpt-4-turbo`, `gpt-4.1-nano`, `o1-mini`, `o1-preview`, `o3-mini` and non-chat ids), on `gpt-5*` with minimal reasoning, and on a model pinned to `api: "chat"`. Nothing falls back silently.

## 5.34.3 - 2026-10-20

### Changed

- The agent skill now exports as `warlock-js-ai-openai`; package discovery descriptions stay within 450 characters.

## 5.34.2 - 2026-10-19

### Fixed

- Replace the loose skill catalog with a package index that points to the provider setup topic, and include orientation in generated LLM projections.

## 5.32.0 - 2026-10-18

### Changed

- Remove the unreleased Kimi/Moonshot `$web_search` builtin echo path; reject declarations of the builtin retiring on 20 October 2026 and document migration to standalone REST tools.

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

### Fixed

- Verified that Responses native token counting preserves the shared unsupported-count signal for `countInputTokens` estimation while authentication errors propagate.

### Added

- Export `kimiSearchTool()` (Basic/Pro), `kimiFetchTool()` and verified `KIMI_SERVER_TOOL_PRICING`: authenticated, cancellable first-party REST calls with compact results, mapped errors, no automatic retries, and billable response usage/costs aggregated into agent reports.

- Retain Responses hosted output/actions/sources and count web-search calls without double-counting stream snapshots. Export opt-in `OPENAI_SERVER_TOOL_PRICING`. Support typed Qwen/DashScope `enableSearch` flags.

## 5.31.0 - 2026-10-18

### Fixed

- Provider body objects replace the adapter-built object when their string `type` discriminator changes, so format and tool-choice overrides do not retain incompatible fields from the old variant. Same-type and undiscriminated objects keep the one-level merge.
- Provider body options merge plain-object fields one level deep, preserving neutral reasoning, generation and structured-output settings unless the caller overrides their keys.

### Added

- Built-in OpenAI list prices (`OPENAI_MODEL_PRICING`, `openAIPricingFor`) for flat-priced models, from OpenAI's pricing page as of 2026-10-17, applied only on the `"openai"` provider label and exact ids. Models priced by prompt length stay unpriced.
- Usage is marked `inputIncludesCache: true`, reports Chat Completions `prompt_tokens_details.cache_write_tokens`, and `complete()` / the streaming `done` chunk attach `usage.cost` when priced.
- 503 / `server_is_overloaded` throws `ProviderOverloadedError`; wrapped errors carry `status`, `billed` and `retryable`.
- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the Chat Completions and Responses models and cancels the HTTP request.
- With `streamChunks`, the Responses model yields `reasoning` for reasoning-summary / reasoning-text deltas and `tool-args` for `response.function_call_arguments.delta`; the Chat model yields `tool-args` for tool-call argument fragments and `reasoning` for a compatible vendor's `reasoning_content` / `reasoning` delta field (DeepSeek, Groq).
- `ai.providerTool({ provider: "openai", definition })` adds Responses built-in tools (`web_search`, `file_search`, `code_interpreter`, …) verbatim. A reasoning item that led into a hosted tool call is left out of the stateless replay, and built-in calls the caller would have to execute (`shell_call`, `apply_patch_call`, `computer_call`, `custom_tool_call`, …) throw `InvalidRequestError` instead of being dropped. Chat Completions sends a provider tool only when its `provider` equals the model's provider label (e.g. `"groq"`).
- `providerOptions.openai.body` forwards native per-call request options for completions and streams while protecting the model, conversation and tool definitions.
- Responses models expose native input-token preflight through `countTokens()`; Chat Completions keeps offline estimates separate.

### Changed

- `promptCacheKey` is sent as `prompt_cache_key` for the `"xai"` and `"mistral"` provider labels as well, since both endpoints document the field. `prompt_cache_retention` and explicit cache breakpoints stay OpenAI-only; other labels receive no cache fields.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.27.0 - 2026-10-01

### Added

- **Responses API (opt-in).** `sdk.model({ name, api: "responses" })` routes an OpenAI model through `/v1/responses`, so a reasoning model (gpt-5 family, o-series, gpt-6) can use function tools with reasoning on. Chat Completions stays the default and is unchanged. Under `api: "responses"` reasoning uses the provider default even when tools are attached (more reasoning tokens and latency than the Chat path, which forces reasoning off with tools); the system prompt is sent as `instructions`; requests use `store: false`; `pdf`/`audio` inputs are off. Only the `openai` provider accepts it: the DeepSeek, Groq, xAI and Mistral adapters reject `api: "responses"`.
- **Responses streaming.** `stream()` works under `api: "responses"` and yields the same chunks as the Chat path: text deltas (refusal text included), then the tool calls, then one `done` with the finish reason and usage. A `response.failed` or `error` event mid-stream throws the same typed error as a failed request.
- **Reasoning replay across tool turns.** Every Responses request asks for `include: ["reasoning.encrypted_content"]`. The reasoning items of a tool-calling turn are saved on the first tool call (`providerMetadata.openaiResponses = { model, reasoningItems }`) and sent back before that turn's function calls on the next request, so the model keeps its own reasoning while it works through tools, with nothing stored on OpenAI's side. Replay is skipped when the model changed, and turns without a tool call are not replayed. **The encrypted reasoning items are stored with the conversation history** (memory or session store), so expect larger stored messages; there is no size cap. The Chat path and the other adapters ignore the key.

## 5.26.0 - 2026-09-30

### Changed

- `reasoning.effort` now accepts every OpenAI SDK 7.23.0 `reasoning_effort` level: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- OpenAI-labelled Chat Completions models now support explicit prompt caching: `promptCacheKey`, `promptCacheRetention`, and `cacheControl.breakpoints` map to the OpenAI SDK's request fields. These fields are deliberately omitted for OpenAI-compatible wrapper providers.
- Capability inference now recognizes the GPT-6 family as reasoning- and vision-capable, plus GPT-5 and o4 as vision-capable.
- **Behaviour change:** requests send `max_completion_tokens` and never the legacy `max_tokens`, which current OpenAI models (the gpt-5 family and later) reject with `400 unsupported_parameter`. `maxTokens` in config and call options is unchanged.
- Reasoning-capable models (o-series, gpt-5 family) no longer receive `temperature`; they accept only the default value and reject any other.

### Fixed

- A provider error now keeps the parameter OpenAI rejected (`context.param`) and the request id (`context.requestId`, read from the SDK's `requestID`), next to the status and code.

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.7.0 - 2026-09-11

### Fixed

- `embed()` on a provider response with an empty `data` array now throws `EmbeddingVectorCountMismatchError` naming the provider and expected/received counts, instead of a bare `TypeError: Cannot read properties of undefined (reading 'embedding')`.
- Chat completions on a provider response with an empty `choices` array now throw a `ProviderError` naming the provider, model, and choice count, instead of a bare `TypeError`.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 4.15.0

### Changed

- **`openai` moves from `^6.34.0` to `^7.4.0`.** The runtime was unaffected: the full suite — 13 files / 208 tests — passed on 7.4.0 _before_ any of the type fixes below were made, so nothing about the wire shape this adapter sends or the responses it reads changed across the major. Every fix in this release is a compile-time one.
- **`OpenAI.Images.ImageGenerateParamsBase` is no longer reachable upstream** — openai 7 split image generation into `ImageGenerateParamsNonStreaming` / `ImageGenerateParamsStreaming` and stopped re-exporting the shared `Base` interface from the `Images` namespace. `image.ts` now sources its `quality` / `output_format` / `background` value types from `ImageGenerateParamsNonStreaming`, which is what the request body was already typed as and what the non-streaming `images.generate` overload accepts. The three fields are inherited from `Base` unchanged, so the accepted values are identical.
- **`ChatCompletionTool` became a union** (`ChatCompletionFunctionTool | ChatCompletionCustomTool`) now that Chat Completions carries custom tools. `.function` is no longer reachable without the `type` discriminant, so the tool-conversion specs narrow on `type === "function"` and throw on anything else — a custom-tool regression fails loudly rather than silently skipping the assertion it used to make.

### Fixed

- **`OpenAISDKConfig.provider` is a usable `string` again.** openai 7 added its own `provider?: Provider` key to `ClientOptions` — an opaque branded object minted by `createProvider()` — and our intersection collapsed the field to `Provider & string`, a type no string literal can inhabit. The config now omits the upstream key (`Omit<ClientOptions, "provider">`) before declaring its own label. No behavior change: the constructor already peeled `provider` off and never forwarded it to the OpenAI client.

## 4.14.0

### Removed

- **BREAKING** — `isOpenAIImageModel()` and `OPENAI_IMAGE_MODEL_PREFIXES` are no longer exported; the `known-image-models` module is deleted. Nothing in the adapter read them once the construction-time gate went away, so they were a public list of model ids that enforced nothing and went stale on OpenAI's release schedule, not this package's. Import them from nowhere — branch on your own id list if you need one.
- **BREAKING** — `isOpenAISpeechModel()` and `isOpenAITranscriptionModel()` are no longer exported either, for the same reason. Once their construction-time gates went away nothing in the adapter read them, leaving two more public model-id lists that enforced nothing. No `@warlock.js/ai-*` adapter validates a model id locally, so the package no longer ships a helper that implies otherwise — branch on your own id list if you need one.

### Changed

- `openai.image({ name })`, `openai.speech({ name })` and `openai.transcribe({ name })` no longer reject an unknown model id at construction — the id is forwarded to OpenAI as given, so an id OpenAI does not serve now fails as a typed provider error instead of a local `InvalidRequestError`.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.9.0 - 2026-08-06

### Fixed

- `reasoning_effort` now defaults to `"none"` automatically on a reasoning-capable model called WITH `tools` and no explicit `reasoning.effort` — previously this required every call site to opt in (added in 4.8.0), so any agent/model config that didn't know to pass it kept hitting rejected tool calls (empty replies, or a hard 400 on newer model generations — `"Function tools with reasoning_effort are not supported ... in /v1/chat/completions"`). An explicit `reasoning.effort` still overrides the default in either direction; calls with no `tools` are unaffected.

## 4.8.0 - 2026-07-19

### Added

- **`reasoning: { effort: "none" }`** now emits `reasoning_effort: "none"` on the wire — unblocks function tools on gpt-5 / o-series reasoning models, which otherwise reject tools on Chat Completions while reasoning is active and return empty replies.

## 4.6.0

### Added

- **`openai.image({ name })`** — image generation for the `gpt-image-*` (token-metered) and `dall-e-*` (per-image) families, for use with `ai.image()`. A non-image model id is rejected at construction.
- **PDF + audio input.** `pdf` and `audio` content parts now map to OpenAI `file` (base64 `file_data`) and `input_audio` (`wav` / `mp3`) parts — opt in with `model({ pdf: true })` / `{ audio: true }`. A remote-URL pdf/audio source raises a typed `InvalidRequestError` up front.
- **`openai.speech({ name })`** — text-to-speech for the `tts-1` / `tts-1-hd` / `gpt-4o-mini-tts` families (`audio.speech.create`), for use with `ai.speech()`.
- **`openai.transcribe({ name })`** — speech-to-text for the `whisper-1` / `gpt-4o-transcribe` families (`audio.transcriptions.create`), for use with `ai.transcribe()`. `whisper-1` defaults to `verbose_json` (duration + segments); a non-TTS/STT model id is rejected at construction.

### Fixed

- **Non-text content parts are no longer coerced to `image_url`.** The message mapper now branches per modality (image → `image_url`, pdf → `file`, audio → `input_audio`) instead of forcing every attachment through the image path.

## 4.5.0 - 2026-07-01

### Fixed

- **All upstream `ClientOptions` now reach the OpenAI client.** The SDK constructor peels off the framework-only `provider` / `pricing` keys and forwards the rest (`timeout`, `maxRetries`, `defaultHeaders`, custom `fetch`, `organization`, `project`, …) verbatim, instead of dropping everything but `apiKey` / `baseURL`.

## 4.4.0 - 2026-06-21

### Fixed

- **Strict structured-output compatibility check is now recursive.** A schema that omits a `required` property anywhere in the tree degrades to loose `json_object` instead of `400`-ing; client-side validation still enforces the full shape.

## 4.3.0 - 2026-06-21

### Added

- `Usage.reasoningTokens` is populated from `completion_tokens_details.reasoning_tokens` (o-series / gpt-5 hidden reasoning channel), emitted only when `> 0`.
- `ModelCallOptions.reasoning.effort` maps to the native `reasoning_effort` param for reasoning-capable models; `reasoning.maxTokens` has no Chat Completions equivalent.
- `ModelCapabilities.reasoning` is inferred from the model name (overridable via `.model(...)`); `promptCaching` is always `true` (OpenAI caches automatically), and `cacheControl` write breakpoints are a no-op.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
