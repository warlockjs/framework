# Changelog — @warlock.js/ai-xai

All notable changes to `@warlock.js/ai-xai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.47.0 - 2026-11-06

### Added

- `XAI_MODEL_PRICING` and `xaiPricingFor(name)` price `grok-4.7`, `grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`, `grok-4.20-multi-agent-0309` and `grok-build-0.1`, with `tiers` for prompts of 200k tokens or more. `xai.model()` uses them when no `pricing` is passed.
- `XAI_MODEL_LIFECYCLE` and `xaiLifecycleFor(name)` give those models a status; `XAI_MODEL_PRICING_AS_OF` dates the price table.
- `capabilities.contextWindow` is reported for `grok-4.3` and `grok-4.20-*` (1,000,000), `grok-4.5` to `grok-4.7` (500,000) and `grok-build-0.1` (256,000). `XAI_CHAT_MODELS` lists the new ids.

## 5.45.0 - 2026-11-05

### Added

- `capabilities.contextWindow` is reported for Grok ids (2,000,000 for `grok-4-fast`/`grok-4-1-fast`, 256,000 for `grok-4`/`grok-code-fast`, 131,072 for `grok-3`/`grok-2`, 32,768 for `grok-2-vision`). New `contextWindow` option on `xai.model`.

## 5.40.0 - 2026-10-29

### Added

- Native `web_search` and `x_search` now work. A call that carries one of those tools is sent to xAI's Responses API (`POST /v1/responses`) with the same model, key and pricing; every other call stays on Chat Completions. `xai.model({ api: "responses" })` sends every call there, and `api: "chat"` pins Chat Completions (a search tool then throws before any request).
- `xai.models()` lists the Grok models the key can use from `GET /v1/models` as `ModelInfo[]`.

### Changed

- Native search no longer throws "requires the Responses API"; it is routed to it. On a gateway that relabels `provider`, the switch is not automatic: set `api: "responses"` on the model.

## 5.34.3 - 2026-10-20

### Changed

- The agent skill now exports as `warlock-js-ai-xai`; package discovery descriptions stay within 450 characters.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

### Fixed

- Document and test explicit rejection of native `web_search` / `x_search` on the current Chat Completions transport, with guidance to use xAI’s Responses API before any request is sent.

## 5.31.0 - 2026-10-18

### Added

- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the model and cancels the HTTP request.
- `XaiModelConfig.promptCacheKey` is sent as `prompt_cache_key` (xAI routes it to `x-grok-conv-id`), so requests sharing a prefix reuse the same cache.

### Changed

- Chat calls inherit `providerOptions.openai.body` from the OpenAI adapter, including its protected fields and one-level plain-object merge. Use only this provider's accepted fields when sharing fallback options. Native `countTokens` remains absent; `sdk.count(text)` is an offline estimate.

### Fixed

- The provider-body and token-estimate guidance renders as prose instead of being swallowed by a stray code fence.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.7.0 - 2026-09-11

### Changed

- Internal type-safety hardening; no behaviour change.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Added

- **First release.** xAI Grok adapter for `@warlock.js/ai` — a thin wrapper over `@warlock.js/ai-openai`'s `OpenAISDK` pinned to `https://api.x.ai/v1` (`provider: "xai"`), so all wire behavior (streaming, tool calls, structured output, error wrapping) is inherited unchanged.
- **`XaiSDK`** — `.model()` / `.embedder()` / `.image()` / `.count()` delegated to the wrapped client. `baseURL` and `provider` are optional (default to xAI's endpoint / label); every other `openai` `ClientOptions` value is forwarded verbatim.
- **xAI-specific capability inference** (`inferVisionCapability` / `inferReasoningCapability`, exported alongside `XAI_VISION_MODEL_PREFIXES` / `XAI_REASONING_MODEL_PREFIXES`) — Grok ids don't match OpenAI's `gpt-*` / `o*` prefixes, so `vision` is auto-`true` for `grok-4` / `grok-2-vision` and `reasoning` for `grok-4` / `grok-3-mini`. An explicit `vision` / `reasoning` per model always wins.
- **`XAI_CHAT_MODELS`** — convenience list of current public Grok chat ids (`grok-4`, `grok-3`, `grok-3-mini`, `grok-2-vision`, `grok-2`).
- **Optional per-model pricing registry** — resolution at `model()` time is per-model `pricing` > SDK registry > `undefined`.
