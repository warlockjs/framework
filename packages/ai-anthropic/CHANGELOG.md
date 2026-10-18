# Changelog — @warlock.js/ai-anthropic

All notable changes to `@warlock.js/ai-anthropic` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.33.0 - 2026-10-19

### Changed

- Lockstep release; package APIs are unchanged.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

### Fixed

- Verified that native token counting preserves the shared unsupported-count signal for `countInputTokens` estimation while authentication errors propagate.

### Added

- Map cumulative hosted web-search/fetch usage in completions and streams while preserving server-tool blocks. Export verified request-fee prices as `ANTHROPIC_SERVER_TOOL_PRICING` for explicit pricing composition.

## 5.31.0 - 2026-10-18

### Upgrading

- Claude models are now priced by default, so `Usage.cost` appears and USD budgets enforce on them without extra configuration. Pass `pricing` to keep contract rates.
- Responses can be longer, and cost more, when `maxTokens` was never set. Set `maxTokens` on the model or per call to keep a lower cap. For a gateway or proxy id, set `maxOutputTokens` so streaming uses the real limit.

### Added

- Built-in Claude API list prices (`ANTHROPIC_MODEL_PRICING`, `anthropicPricingFor`, `withAnthropicCacheWriteRates`), from Anthropic's pricing page as of 2026-10-17, used when neither the model nor the SDK registry is priced. Dated snapshot ids resolve to their alias. Claude Haiku 5.5 (priced by prompt length) is left unpriced.
- `complete()` and the streaming `done` chunk attach `usage.cost` when the model is priced.
- 529 / `overloaded_error` responses and mid-stream overload events throw `ProviderOverloadedError`; every wrapped error carries `status`, `billed` and `retryable`.
- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the model and cancels the HTTP request.
- `AnthropicModelConfig.maxOutputTokens` overrides the inferred model output limit that sizes the default `max_tokens`.
- With `streamChunks`, `stream()` yields `reasoning` for `thinking_delta`, `tool-args` for the `input_json_delta` of client `tool_use` blocks, and `usage` after `message_start` and each `message_delta`. `send()` takes the same `streamChunks` transport option.
- `ai.providerTool({ provider: "anthropic", definition })` entries (`web_search`, `web_fetch`, `code_execution`, `bash`, `text_editor`, `memory`, …) are sent verbatim ahead of the function tools; the prompt-cache breakpoint stays on the last function tool. Other providers' tools are skipped with a warning. The reserved `providerOptions.anthropic.body` keys are unchanged.
- Typed context management on `providerOptions.anthropic`: `contextManagement.clearToolUses` / `clearThinking` (`clear_tool_uses_20250919` / `clear_thinking_20251015`, beta `context-management-2025-06-27`) and `serverCompaction` (`compact_20260112`, beta `compact-2026-01-12`, trigger of at least 50,000 input tokens). The adapter builds the edits in the order the API requires and adds the beta headers; combining them with `body.context_management` fails with `InvalidRequestError`.
- `thinkingBlockBinding: "error" | "drop_block"` sends `thinking.block_binding.prefix_mismatch_behavior` with the `thinking-binding-controls-2026-08-01` beta.
- Preserved thinking after client-side compaction: on Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 an assistant turn marked `compaction: "retained"` is replayed without its thinking blocks, which were produced against the replaced history. `AnthropicModelConfig.preservedThinking` overrides the inference; `inferPreservedThinking(name)` and `ToAnthropicMessagesOptions` are exported.
- `AnthropicModel.buildRequest()` creates a detached request snapshot for preflight auditing; `send(request)` sends that snapshot as a completion or stream without rebuilding its body.
- Message, tool and provider-block converters and request types are exported from the package root for hosts using their own transport.

### Changed

- `reasoning: { effort: "none" }` now turns thinking off on Claude Sonnet 5 and Claude Haiku 5.5 with `thinking: { type: "disabled" }` (sent alone, so Haiku 5.5 stays at its default effort, inside the range where `disabled` is accepted). Previously no `thinking` field was sent and both models ran adaptive thinking by default.
- `reasoning: { effort: "none" }` on Claude Opus 5 now sends adaptive thinking at `output_config.effort: "low"` instead of omitting `thinking` (which ran at the default `high`). Opus 5 is deliberately not sent `disabled`: with thinking off it can write a tool call as plain text that never runs, and leak thinking tags. Claude Opus 5.5, Sonnet 5.5 and Fable 5 / 5.1 are unchanged.
- **BREAKING** The default `max_tokens` (when no `maxTokens` is set) rose from 4096. Streaming requests use the model's documented max output — 128K for the Claude 5 family and Opus 4.6–4.8 / Sonnet 4.6, 64K for Opus / Sonnet / Haiku 4.5 — and non-streaming requests use 16384, capped by the model's max output (the Anthropic SDK requires streaming for larger non-streaming requests unless the client sets a `timeout`). Unknown ids default to 16384. With thinking on, the default still keeps room for the thinking budget plus 4096 answer tokens, within the model's limit.

### Fixed

- Usage is marked `inputIncludesCache: false` (Anthropic's `input_tokens` excludes cache reads and writes), and 1-hour cache writes are reported in `cacheWrite1hTokens` from `cache_creation.ephemeral_1h_input_tokens` — or, when the breakdown is missing, from a request whose every cache marker asked for `ttl: "1h"`. Cost now bills reads and writes once each, at their own rates.
- Caller pricing that omits cache-write rates gets Anthropic's documented multipliers (5-minute writes 1.25x input, 1-hour writes 2x) instead of billing writes at nothing.
- Usage includes server-side compaction: the `compaction` entries of `usage.iterations`, which the top-level token counts leave out, are added to `input`, `output` and the cache counts (completions and streams).
- `complete()` always builds a non-streaming request, including when an indexed `stream` option is supplied.
- A request that fails to build in `complete()`, `stream()` or `countTokens()` (a reserved `providerOptions.anthropic.body` key, or a `body` value `structuredClone` cannot copy, such as a function) is logged like a send failure and rejects with an `AIError`; errors that are not already one become an `InvalidRequestError` carrying the original as `cause`. Before, the raw error escaped unlogged. `buildRequest()` itself still throws the raw error.
- The debug log line for a streaming request reads "Starting streaming call to messages.create" again; non-streaming requests keep "Starting call to messages.create".
- The provider docs and `setup-anthropic` skill say that `send()` passes `betas` only to the `"beta.messages"` endpoint.

## 5.30.0 - 2026-10-16

### Upgrading

- `model_context_window_exceeded` now maps to `finishReason: "context_exceeded"` (was `length`), `pause_turn` to `pause_turn` and `refusal` to `refusal` (both were `error`).
- `providerOptions.anthropic.body` may not set `model`, `messages`, `system`, `tools`, `mcp_servers` or `stream`: the call fails with `InvalidRequestError` instead of silently replacing the conversation, the model or the registered tools.

### Added

- Responses with thinking, redacted-thinking, compaction, server-tool or cited-text blocks return the whole ordered turn as `ModelResponse.blocks` (and on the streaming `done` chunk); an assistant message carrying Anthropic `blocks` is replayed verbatim.
- `providerOptions.anthropic` (`AnthropicCallOptions`): `betas` routes the call through `client.beta.messages`, `body` merges extra request fields last (`context_management`, `fallbacks`, `inference_geo`, …), `thinkingDisplay` sets `thinking.display`.
- `AnthropicModel.countTokens(messages, options?)` counts input tokens through `messages.countTokens`; `AnthropicModel` is exported and `AnthropicSDK.model()` returns it.
- Per-call `cacheControl.ttl` overrides the model's `promptCacheTtl`.

### Changed

- Consecutive tool results are sent as one `user` message with several `tool_result` blocks, as Anthropic expects for parallel tool use.
- Claude 5-family thinking rules: Opus 5.5, Sonnet 5.5 and Fable 5 / 5.1 never receive `budget_tokens` or `disabled`.
- `effort: "none"` on Claude Sonnet 5.5 sends `thinking: { type: "between_tools" }` (its only thinking-off form, sent alone with no `output_config.effort` or `display`); it used to omit `thinking`, so the model still thought at its default effort. Opus 5.5 and Fable 5 / 5.1 have no thinking-off form and keep omitting `thinking`.

### Fixed

- `providerOptions.anthropic.thinkingDisplay` is applied only to adaptive thinking, so it is never sent beside `between_tools` (a 400).
- **Security:** a stored block is replayed only when its `data.type` equals its declared `type` and the type is one Claude returns on an assistant turn (text, thinking, redacted thinking, tool use, server-tool use and results, MCP, container upload, compaction). A transcript from outside the process can no longer smuggle a `tool_use` or user-side block past the tool-id check; such turns are rebuilt from `content` + `toolCalls`.

## 5.29.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged. Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged.

## 5.27.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged.

## 5.26.0 - 2026-09-30

### Fixed

- Adaptive Claude reasoning now maps `minimal` to `output_config.effort: "low"` and supports `xhigh` and `max`; budget-mode models map them to 1,024, 24,000, and 32,000 thinking tokens respectively.
- Claude reasoning-token usage is now included in responses when the API reports it, including streamed responses.
- Responses stopped because the model context window was exceeded now report a length finish reason.
- **Behaviour change:** Reasoning now works on current Claude models. Claude Opus 4.7, 4.8, 5 and 5.5, Sonnet 5 and 5.5, Fable 5 and 5.1, and any model id the adapter does not recognise now get `thinking: { type: "adaptive" }` with `output_config.effort` (`low`, `medium` or `high`, taken from `reasoning.effort`; `medium` when only `reasoning.maxTokens` is given). Before, every model got `budget_tokens`, which these models reject with a 400. Claude Haiku 4.5, Opus 4.6, Sonnet 4.6 and older models keep the `budget_tokens` shape. The default `max_tokens` is unchanged in both modes.
- **Behaviour change:** `temperature` is no longer sent to models released after Claude Opus 4.6 (the same adaptive-thinking models listed above), because they reject any value other than the default with a 400. Haiku 4.5, the 4.6 models and older models still receive it.
- **Behaviour change:** Claude 5-series models (`claude-opus-5*`, `claude-sonnet-5*`, `claude-fable-5*`, `claude-mythos-5*`) are now recognised as vision-capable, so image attachments are no longer rejected for them.

### Added

- `thinkingMode: "adaptive" | "budget"` on `anthropic.model({ ... })` overrides the thinking shape inferred from the model name. Use it for gateway model ids that don't follow Anthropic's naming, or to move Opus/Sonnet 4.6 onto adaptive thinking. It also decides whether `temperature` is sent. The `AnthropicThinkingMode` type is exported.
- `promptCaching: true` now enables Anthropic's request-level automatic cache placement when a call has no explicit cache breakpoint, so the longest reusable prefix is cached. `promptCacheTtl?: "5m" | "1h"` controls the TTL for automatic and explicit cache markers; omission keeps Anthropic's five-minute default.

## 5.25.0 - 2026-09-28

### Changed

- Lockstep release; package APIs are unchanged.

## 5.24.0 - 2026-09-27

### Fixed

- Preserve signed and redacted extended-thinking blocks across Anthropic tool-use follow-ups, and ensure `max_tokens` exceeds the thinking budget.

### Changed

- Lockstep release; package APIs are unchanged.

## 5.23.2 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.1 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.0 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.1 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.

## 5.21.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-anthropic`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-anthropic`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-anthropic`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.8.0 - 2026-07-19

### Changed

- **`reasoning: { effort: "none" }`** disables extended thinking (emits no `thinking` block) — the neutral "run without reasoning" level, consistent across adapters.

## 4.5.0 - 2026-07-01

### Fixed

- **All upstream `ClientOptions` now reach the Anthropic client.** The SDK constructor peels off the framework-only `provider` / `pricing` keys and forwards the rest (`timeout`, `maxRetries`, `defaultHeaders`, custom `fetch`, `baseURL`, …) verbatim, instead of dropping everything but `apiKey` / `baseURL`.

## 4.3.0 - 2026-06-21

### Added

- **Usage accounting** — `usage.cacheWriteTokens` is populated from Anthropic's `cache_creation_input_tokens` (alongside `cachedTokens`); `reasoningTokens` is left unset because Anthropic bills thinking inside `output_tokens`.
- **Extended thinking** — `ModelCallOptions.reasoning` maps to Anthropic's `thinking` budget (`reasoning.effort` → a tiered budget, floored at 1024); `temperature` is dropped when thinking is enabled.
- **System-prompt prompt caching** — `cacheControl.breakpoints >= 1` emits the system prompt with `cache_control: { type: "ephemeral" }`.
- **Capabilities** — `reasoning`, `promptCaching`, and `pdf` are now advertised; `audio` stays absent.

## 4.2.0

### Added

- Opt-in `promptCaching` flag on the model config — marks tool definitions with `cache_control: { type: "ephemeral" }` so multi-trip agents reuse the static tool schemas at the cache-read rate. Off by default.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
