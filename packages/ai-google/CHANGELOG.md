# Changelog — @warlock.js/ai-google

All notable changes to `@warlock.js/ai-google` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.3.0 - 2026-06-21

### Added

- Cost-truth contract wiring (additive, non-breaking):
  - `Usage.reasoningTokens` is now populated from Gemini's `usageMetadata.thoughtsTokenCount` (thinking-phase tokens), alongside the existing `Usage.cachedTokens` from `cachedContentTokenCount`. Both surface only when reported `> 0`.
  - `ModelCallOptions.reasoning` maps to Gemini's `config.thinkingConfig`: `reasoning.maxTokens` → `thinkingBudget` directly, `reasoning.effort` → a bucketed budget (`low` 1024 / `medium` 8192 / `high` 24576). Honored only for `reasoning`-capable models.
  - `ModelCapabilities` now reports `reasoning: true`, `promptCaching: true`, and `audio` / `pdf` (mirroring the multimodal `vision` inference) for Gemini models. New `GoogleModelConfig` overrides: `reasoning`, `audio`, `pdf`.
  - `ModelCallOptions.cacheControl` is accepted as a graceful no-op (Gemini has no per-call cache-write breakpoint; read-side `cachedTokens` accounting is unaffected).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
