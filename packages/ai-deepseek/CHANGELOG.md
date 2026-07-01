# Changelog — @warlock.js/ai-deepseek

All notable changes to `@warlock.js/ai-deepseek` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Added

- **First release.** DeepSeek adapter for `@warlock.js/ai` — a thin wrapper over `@warlock.js/ai-openai`'s `OpenAISDK` pinned to `https://api.deepseek.com` (`provider: "deepseek"`), so all wire behavior (streaming, tool calls, structured output, error wrapping) is inherited unchanged.
- **`DeepSeekSDK`** — `.model()` / `.embedder()` / `.image()` / `.count()` delegated to the wrapped client. `baseURL` and `provider` are optional (default to DeepSeek's endpoint / label); every other `openai` `ClientOptions` value is forwarded verbatim.
- **DeepSeek-specific capability inference** (`inferReasoningCapability` / `inferVisionCapability`) — `reasoning` is auto-`true` for `deepseek-reasoner` and the `*-pro` tier, auto-`false` for `deepseek-chat` / `*-flash`; `vision` is `false` for every id (no documented vision surface). An explicit `reasoning` / `vision` per model always wins.
- **Built-in DeepSeek pricing defaults** (USD per 1M tokens) for `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-pro`, so `usage.cost` is computed out of the box; overridable per model or per SDK.
- **`DEEPSEEK_CHAT_MODELS`** — informational list of the documented chat model ids.
