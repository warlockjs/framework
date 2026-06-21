# Changelog — @warlock.js/ai-bedrock

All notable changes to `@warlock.js/ai-bedrock` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.3.0 - 2026-06-21

### Added

- **Cost-truth contract wiring.** Capabilities now report `reasoning`, `promptCaching`, `pdf`, and `audio` truthfully per model family (inferred from the model id, overridable via `bedrock.model({ name, reasoning?, promptCaching?, pdf?, audio? })`): `reasoning` for Claude 3.7 + Claude 4, `promptCaching` for Claude 3.5+/3.7/4 and Nova, `pdf` for Claude 3+ and Nova, `audio` defaulting to `false`.
- **Reasoning / extended thinking.** `ModelCallOptions.reasoning` maps to Converse `additionalModelRequestFields.thinking = { type: "enabled", budget_tokens }` for reasoning-capable models — `reasoning.maxTokens` is the explicit budget, `reasoning.effort` (low/medium/high) maps to a conventional budget. No-ops for non-reasoning models so unsupported params never reach the wire.
- **Prompt-cache write breakpoints.** `ModelCallOptions.cacheControl.breakpoints` appends a Converse `cachePoint` block to the last message for `promptCaching`-capable models.
- **`Usage.cacheWriteTokens`** populated from Converse `usage.cacheWriteInputTokens` on both `complete()` and `stream()` (alongside the existing `cachedTokens` from `cacheReadInputTokens`). `Usage.reasoningTokens` is intentionally left unset — Bedrock's Converse `TokenUsage` reports no reasoning-token channel.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
