# Changelog — @warlock.js/ai-mistral

All notable changes to `@warlock.js/ai-mistral` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Added

- **First release.** `MistralSDK` — a thin wrapper over `@warlock.js/ai-openai` that points one internal `OpenAISDK` at Mistral's OpenAI-compatible endpoint (`https://api.mistral.ai/v1`) with `provider: "mistral"`, delegating transport, streaming, tool calls, structured output, error wrapping, and token accounting to the battle-tested adapter. Exposes `.model()`, `.embedder()` (`mistral-embed`), and `.count()`.
- **Mistral-aware capability inference** — `vision` is auto-set for the `pixtral` family and recent multimodal generations (`mistral-large`, `mistral-medium`, `ministral-3`); `reasoning` for the `magistral` family and the hybrid `mistral-small` generation. An explicit `vision` / `reasoning` on `.model()` always wins. Exported as `inferVisionCapability` / `inferReasoningCapability`, with the `-latest` aliases grouped under `MISTRAL_MODELS`.
- **Default pricing registry** (`MISTRAL_DEFAULT_PRICING`, USD per 1,000,000 tokens) merged under any caller-supplied `pricing` so cost truth works out of the box; per-model > SDK-level > default > `undefined`. No `image()` — Mistral has no OpenAI-compatible image endpoint.
