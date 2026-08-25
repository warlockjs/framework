# Changelog — @warlock.js/ai-xai

All notable changes to `@warlock.js/ai-xai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

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
