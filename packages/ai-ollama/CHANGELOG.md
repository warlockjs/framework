# Changelog — @warlock.js/ai-ollama

All notable changes to `@warlock.js/ai-ollama` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.3.0 - 2026-06-21

### Added

- Cost-truth contract wiring. `ModelCapabilities` now reports `reasoning` (inferred from thinking-capable model tags — `deepseek-r1`, `qwq`, `qwen3`, `magistral`, `phi4-reasoning`, `cogito`, `smallthinker`, `exaone-deep`, `gpt-oss`; overridable via `ollama.model({ name, reasoning })`), plus `promptCaching`, `audio`, and `pdf` reported truthfully as `false` (Ollama supports none).
- `ModelCallOptions.reasoning` maps onto Ollama's native `think` request flag: `reasoning.effort` (`low`/`medium`/`high`) passes straight through, and an effort-less hint becomes `think: true`. The flag is sent only to `reasoning`-capable models; `reasoning.maxTokens` and `cacheControl` are honored as graceful no-ops (Ollama exposes no thinking-budget cap and no prompt cache).

### Notes

- `Usage` stays honest: Ollama reports no prompt-cache or reasoning-token counts, so `cachedTokens` / `cacheWriteTokens` / `reasoningTokens` remain `undefined` (reasoning tokens are folded into `eval_count`; the adapter does not fabricate a count from the `message.thinking` text).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
