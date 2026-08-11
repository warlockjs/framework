# Changelog — @warlock.js/ai-ollama

All notable changes to `@warlock.js/ai-ollama` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.8.0 - 2026-07-19

### Changed

- **`reasoning: { effort: "none" }`** maps to `think: false` — the neutral "run without reasoning" level, consistent across adapters.

## 4.3.0 - 2026-06-21

### Added

- `ModelCapabilities.reasoning` is inferred from thinking-capable model tags (overridable via `ollama.model({ name, reasoning })`); `promptCaching` / `audio` / `pdf` report `false`.
- `ModelCallOptions.reasoning` maps onto Ollama's native `think` flag for reasoning-capable models; `reasoning.maxTokens` and `cacheControl` are graceful no-ops.

### Notes

- `Usage` stays honest — Ollama reports no prompt-cache or reasoning-token counts, so those fields remain `undefined`; the adapter never fabricates a count.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
