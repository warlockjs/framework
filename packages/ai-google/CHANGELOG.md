# Changelog — @warlock.js/ai-google

All notable changes to `@warlock.js/ai-google` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Added

- **`google.image({ name })`** — Imagen (`imagen-*`) image generation for use with `ai.image()`. Per-image-metered; when every candidate is safety-filtered the run surfaces a typed `ContentFilterError`. A non-Imagen model id is rejected at construction.

### Fixed

- **PDF + audio input are now explicitly mapped and tested.** The content-part mapper documents and proves that `pdf` / `audio` parts route to Gemini `inlineData` (the `pdf` / `audio` capabilities the adapter advertises are backed by a real mapper, not an accident of the image path), and the remote-URL rejection now names the actual modality instead of always saying "images".

## 4.3.0 - 2026-06-21

### Added

- `Usage.reasoningTokens` is populated from Gemini's `thoughtsTokenCount` (alongside `cachedTokens`), surfaced only when reported `> 0`.
- `ModelCallOptions.reasoning` maps to Gemini's `thinkingConfig` (`maxTokens` → `thinkingBudget`, `effort` → a bucketed budget) for reasoning-capable models.
- `ModelCapabilities` now reports `reasoning`, `promptCaching`, `audio`, and `pdf`; `cacheControl` is accepted as a graceful no-op.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
