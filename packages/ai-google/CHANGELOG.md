# Changelog — @warlock.js/ai-google

All notable changes to `@warlock.js/ai-google` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.3.0 - 2026-06-21

### Added

- `Usage.reasoningTokens` is populated from Gemini's `thoughtsTokenCount` (alongside `cachedTokens`), surfaced only when reported `> 0`.
- `ModelCallOptions.reasoning` maps to Gemini's `thinkingConfig` (`maxTokens` → `thinkingBudget`, `effort` → a bucketed budget) for reasoning-capable models.
- `ModelCapabilities` now reports `reasoning`, `promptCaching`, `audio`, and `pdf`; `cacheControl` is accepted as a graceful no-op.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
