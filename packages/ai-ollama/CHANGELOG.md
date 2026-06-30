# Changelog — @warlock.js/ai-ollama

All notable changes to `@warlock.js/ai-ollama` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.3.0 - 2026-06-21

### Added

- `ModelCapabilities.reasoning` is inferred from thinking-capable model tags (overridable via `ollama.model({ name, reasoning })`); `promptCaching` / `audio` / `pdf` report `false`.
- `ModelCallOptions.reasoning` maps onto Ollama's native `think` flag for reasoning-capable models; `reasoning.maxTokens` and `cacheControl` are graceful no-ops.

### Notes

- `Usage` stays honest — Ollama reports no prompt-cache or reasoning-token counts, so those fields remain `undefined`; the adapter never fabricates a count.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
