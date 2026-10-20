# Changelog — @warlock.js/ai-mistral

All notable changes to `@warlock.js/ai-mistral` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.34.3

### Changed

- The agent skill now exports as `warlock-js-ai-mistral`; package discovery descriptions stay within 450 characters.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Added

- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the model and cancels the HTTP request.
- `MistralModelConfig.promptCacheKey` is sent as `prompt_cache_key`.

### Changed

- Chat calls inherit `providerOptions.openai.body` from the OpenAI adapter, including its protected fields and one-level plain-object merge. Use only this provider's accepted fields when sharing fallback options. Native `countTokens` remains absent; `sdk.count(text)` is an offline estimate.

### Fixed

- `MISTRAL_DEFAULT_PRICING` matches Mistral's current price list (2026-10-17), with cache-read rates and API ids beside the `-latest` aliases. Retired Pixtral and Magistral entries are removed.

### Upgrading

- **BREAKING** `pixtral-*` and `magistral-*` models no longer have built-in prices, so a USD budget on them rejects the run as unpriced. Pass `pricing` for them.

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

- **First release.** `MistralSDK` — a thin wrapper over `@warlock.js/ai-openai` that points one internal `OpenAISDK` at Mistral's OpenAI-compatible endpoint (`https://api.mistral.ai/v1`) with `provider: "mistral"`, delegating transport, streaming, tool calls, structured output, error wrapping, and token accounting to the battle-tested adapter. Exposes `.model()`, `.embedder()` (`mistral-embed`), and `.count()`.
- **Mistral-aware capability inference** — `vision` is auto-set for the `pixtral` family and recent multimodal generations (`mistral-large`, `mistral-medium`, `ministral-3`); `reasoning` for the `magistral` family and the hybrid `mistral-small` generation. An explicit `vision` / `reasoning` on `.model()` always wins. Exported as `inferVisionCapability` / `inferReasoningCapability`, with the `-latest` aliases grouped under `MISTRAL_MODELS`.
- **Default pricing registry** (`MISTRAL_DEFAULT_PRICING`, USD per 1,000,000 tokens) merged under any caller-supplied `pricing` so cost truth works out of the box; per-model > SDK-level > default > `undefined`. No `image()` — Mistral has no OpenAI-compatible image endpoint.
