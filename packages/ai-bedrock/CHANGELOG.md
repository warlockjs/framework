# Changelog — @warlock.js/ai-bedrock

All notable changes to `@warlock.js/ai-bedrock` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-bedrock`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-bedrock`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-bedrock`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.3.0 - 2026-06-21

### Added

- **Cost-truth capabilities** — `reasoning`, `promptCaching`, `pdf`, and `audio` are reported truthfully per model family (inferred from the model id, overridable via `bedrock.model(...)`).
- **Reasoning / extended thinking** — `ModelCallOptions.reasoning` maps to Converse `thinking` for reasoning-capable models, and no-ops elsewhere so unsupported params never reach the wire.
- **Prompt-cache write breakpoints** — `cacheControl.breakpoints` appends a Converse `cachePoint` block for caching-capable models.
- **`Usage.cacheWriteTokens`** populated from Converse `cacheWriteInputTokens`; `reasoningTokens` is left unset (Bedrock reports no reasoning channel).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
