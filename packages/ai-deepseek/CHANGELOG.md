# Changelog — @warlock.js/ai-deepseek

All notable changes to `@warlock.js/ai-deepseek` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Added

- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the model and cancels the HTTP request.

### Changed

- Chat calls inherit `providerOptions.openai.body` from the OpenAI adapter, including its protected fields and one-level plain-object merge. Use only this provider's accepted fields when sharing fallback options. Native `countTokens` remains absent; `sdk.count(text)` is an offline estimate.

### Fixed

- `DEEPSEEK_DEFAULT_PRICING` (now exported) matches DeepSeek's price list (2026-10-17) for `deepseek-flash`, `deepseek-v4-flash` and `deepseek-v4-pro`. DeepSeek bills by time of day; the defaults are the peak rates, an upper bound, and `DEEPSEEK_OFF_PEAK_PRICING` holds the off-peak rates.

### Upgrading

- **BREAKING** `deepseek-chat` and `deepseek-reasoner` (discontinued by DeepSeek) no longer have built-in prices, so a USD budget on them rejects the run as unpriced. Reported costs for the remaining models rise to the peak rates; pass `pricing: DEEPSEEK_OFF_PEAK_PRICING` when you run off-peak.

## 5.30.0 - 2026-10-16

### Changed

- Lockstep release; package APIs are unchanged.

## 5.29.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged. Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged. `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.27.0 - 2026-10-01

### Changed

- Lockstep release; package APIs are unchanged.

## 5.26.0 - 2026-09-30

### Changed

- Lockstep release; package APIs are unchanged.

## 5.25.0 - 2026-09-28

### Changed

- Lockstep release; package APIs are unchanged.

## 5.24.0 - 2026-09-27

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

## 5.7.0 - 2026-09-11

### Changed

- Internal type-safety hardening; no behaviour change.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-deepseek`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-deepseek`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-deepseek`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Added

- **First release.** DeepSeek adapter for `@warlock.js/ai` — a thin wrapper over `@warlock.js/ai-openai`'s `OpenAISDK` pinned to `https://api.deepseek.com` (`provider: "deepseek"`), so all wire behavior (streaming, tool calls, structured output, error wrapping) is inherited unchanged.
- **`DeepSeekSDK`** — `.model()` / `.embedder()` / `.image()` / `.count()` delegated to the wrapped client. `baseURL` and `provider` are optional (default to DeepSeek's endpoint / label); every other `openai` `ClientOptions` value is forwarded verbatim.
- **DeepSeek-specific capability inference** (`inferReasoningCapability` / `inferVisionCapability`) — `reasoning` is auto-`true` for `deepseek-reasoner` and the `*-pro` tier, auto-`false` for `deepseek-chat` / `*-flash`; `vision` is `false` for every id (no documented vision surface). An explicit `reasoning` / `vision` per model always wins.
- **Built-in DeepSeek pricing defaults** (USD per 1M tokens) for `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-pro`, so `usage.cost` is computed out of the box; overridable per model or per SDK.
- **`DEEPSEEK_CHAT_MODELS`** — informational list of the documented chat model ids.
