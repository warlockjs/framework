# Changelog — @warlock.js/ai-google

All notable changes to `@warlock.js/ai-google` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-google`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-google`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-google`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.15.0

### Added

- **`GeminiImageModel` — a Gemini-native image path over `ai.models.generateContent`** (new `src/gemini-image.ts`, exported as `GeminiImageModel`). Requests `responseModalities: ["TEXT", "IMAGE"]` (override the list verbatim with `options.responseModalities`), maps `aspectRatio` / `imageSize` / `personGeneration` onto Gemini's `config.imageConfig`, and reshapes inline image parts that come back into the **same** `GeneratedImage[]` (`{ type: "base64", base64, mediaType }`, `image/png` fallback) the Imagen path emits — so `ai.image()`'s envelope is unchanged for callers
- **Token usage is passed through on the Gemini image path instead of hard-zeroed.** Whatever `usageMetadata` Google attaches becomes `usage.input` / `output` / `total` (plus `cachedTokens` / `reasoningTokens` when reported `> 0`); only an absent block collapses to zeros. The Imagen path stays a flat zero because Imagen reports no tokens at all. Price these models with `{ input, output }` rather than `{ perImage }`, and check the first live `usage` — whether these models report tokens is not confirmed here. The mapping is now a shared `applyGoogleUsage` util used by both the chat model and the image model, so one rule decides what a Gemini token report means package-wide
- A response with **no image part is never a silent empty success**: a blocked prompt (`promptFeedback.blockReason`) or a safety/policy `finishReason` (`SAFETY`, `IMAGE_SAFETY`, `PROHIBITED_CONTENT`, `IMAGE_PROHIBITED_CONTENT`, `RECITATION`, `IMAGE_RECITATION`, `BLOCKLIST`, `SPII`) throws `ContentFilterError` carrying the reason; a text-only answer throws `ProviderError` **quoting the text the model returned**; anything else throws `ProviderError` naming the part count and finish reason

### Fixed

- **`google.image({ name: "gemini-…" })` no longer hits the endpoint that 404s it.** `ai.models.generateImages` routes to `{model}:predict` (`generateImages` → `generateImagesInternal` → `formatMap('{model}:predict', …)` in `@google/genai`'s bundle), which does not serve the Gemini image models — the call came back `404 models/… is not found for API version v1beta, or is not supported for predict`. `GoogleSDK.image()` now picks the transport from the id: a `gemini-` id (with an optional `models/` resource prefix) gets the new `generateContent` implementation, everything else keeps `GoogleImageModel` / `generateImages`. **Scope of the proof:** two levels. Measured here — on the new transport such an id got as far as a quota error (HTTP 429) instead of the 404, which establishes that the endpoint accepts the id. Reported by the maintainer — once billing was enabled on the project, the path returned an image end-to-end from an application running a locally linked build of this package. No test in this package calls Google; the suite proves the request shape and the error mapping, not the round trip

### Deprecated

- **Google has deprecated `generateImages`, the transport the `imagen-*` path still uses.** Verbatim from the `@google/genai` runtime warning: *"The generateImages method is deprecated and will be removed in the next major release (not before Jan. 1 2027). Please use the generateContent method with image models instead. See https://ai.google.dev/gemini-api/docs/deprecations#imagen-models and https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation#generate-images"* (`editImage` carries the same notice.) Nothing breaks today and the Imagen path is unchanged, but it is on a clock: new image work should prefer a `gemini-` id. The warning is emitted by `@google/genai` ≥ 2.17; with the bump below, this package now prints it whenever the `imagen-*` path is used

### Changed

- **`@google/genai` moves from `^2.4.0` to `^2.17.1`** (2.17.1 is what installs today). The Gemini image path does not depend on the bump — `models.generateContent` exists in both — but the older range predates the deprecation notice above and predates `ai.interactions`, so staying on it meant documenting an SDK surface the package could not reach. The 11 suites / 149 specs in this package pass unchanged on 2.17.1. Note this re-resolved the whole workspace lockfile, not just this package's dependency
- `GoogleSDK.image()` returns `GeminiImageModel` for a `gemini-` id. This is **routing, not validation** — no id is rejected locally: an id matching neither family takes the `generateImages` route, the only route that existed before, so every id that reached Google before still reaches Google the same way and still fails (or succeeds) at the provider

### Not included

- **The `interactions` API is not used.** `@google/genai` ≥ 2.17 adds `ai.interactions.create({ model, input, response_format: { type: "image", … } })` with images at `interaction.output_image.data` and a different snake_case usage shape (`total_input_tokens` …). It is reachable now that the SDK is on 2.17.1, but nothing in this package calls it: it would need its own usage mapper and its own error surface, and its own request type already marks `response_modalities` / `response_mime_type` deprecated. If it lands it will be an **opt-in config flag**, not id routing

## 4.14.0

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
