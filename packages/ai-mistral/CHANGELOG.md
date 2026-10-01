# Changelog — @warlock.js/ai-mistral

All notable changes to `@warlock.js/ai-mistral` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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

No changes to `@warlock.js/ai-mistral`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-mistral`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-mistral`. Released in lockstep with the `create-warlock` vite
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

- **First release.** `MistralSDK` — a thin wrapper over `@warlock.js/ai-openai` that points one internal `OpenAISDK` at Mistral's OpenAI-compatible endpoint (`https://api.mistral.ai/v1`) with `provider: "mistral"`, delegating transport, streaming, tool calls, structured output, error wrapping, and token accounting to the battle-tested adapter. Exposes `.model()`, `.embedder()` (`mistral-embed`), and `.count()`.
- **Mistral-aware capability inference** — `vision` is auto-set for the `pixtral` family and recent multimodal generations (`mistral-large`, `mistral-medium`, `ministral-3`); `reasoning` for the `magistral` family and the hybrid `mistral-small` generation. An explicit `vision` / `reasoning` on `.model()` always wins. Exported as `inferVisionCapability` / `inferReasoningCapability`, with the `-latest` aliases grouped under `MISTRAL_MODELS`.
- **Default pricing registry** (`MISTRAL_DEFAULT_PRICING`, USD per 1,000,000 tokens) merged under any caller-supplied `pricing` so cost truth works out of the box; per-model > SDK-level > default > `undefined`. No `image()` — Mistral has no OpenAI-compatible image endpoint.
