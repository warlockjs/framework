# Changelog — @warlock.js/ai-google

All notable changes to `@warlock.js/ai-google` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.13.0

### Removed

- **BREAKING — `isGoogleImageModel()` and `GOOGLE_IMAGE_MODEL_PREFIXES` are gone from the public API.** Both were dropped from the package entrypoint and the module deleted; importing either from `@warlock.js/ai-google` is now a compile error. With the construction-time guard gone (below) they enforced nothing and only invited callers to re-implement a model allow-list the framework does not own — a model id is the provider's to rule on, so there is nothing left for a local list to say. Callers that branched on the Imagen family should match on the id themselves (`name.startsWith("imagen-")`) or, better, stop branching and let the provider answer

### Changed

- `google.image({ name })` no longer rejects a non-`imagen-*` model id at construction — the id is passed through to `ai.models.generateImages` as given, so an id Google does not serve now fails as a typed provider error instead of a local `InvalidRequestError`

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.8.0 - 2026-07-19

### Changed

- **`reasoning: { effort: "none" }`** maps to `thinkingBudget: 0` — Gemini's native reasoning-off switch, the neutral "run without reasoning" level.

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
