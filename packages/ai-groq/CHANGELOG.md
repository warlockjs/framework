# Changelog — @warlock.js/ai-groq

All notable changes to `@warlock.js/ai-groq` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.34.3

### Changed

- The agent skill now exports as `warlock-js-ai-groq`; package discovery descriptions stay within 450 characters.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Added

- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` on the model and cancels the HTTP request.

### Changed

- Chat calls inherit `providerOptions.openai.body` from the OpenAI adapter, including its protected fields and one-level plain-object merge. Use only this provider's accepted fields when sharing fallback options. Native `countTokens` remains absent; `sdk.count(text)` is an offline estimate.

### Fixed

- `GROQ_DEFAULT_PRICING` (now exported) matches Groq's published prices (2026-10-17): `openai/gpt-oss-120b` output is 0.60, the gpt-oss models get their 50% cache-read rate, and `qwen/qwen3.8-27b` is added.

### Upgrading

- **BREAKING** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` and `deepseek-r1-distill-llama-70b` no longer have built-in prices (Groq publishes none), so a USD budget on them rejects the run as unpriced. Pass `pricing` for them.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.7.0 - 2026-09-11

### Changed

- Internal type-safety hardening; no behaviour change.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Added

- **First release.** `GroqSDK` — a thin wrapper over `@warlock.js/ai-openai` that points one internal `OpenAISDK` at Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`) with `provider: "groq"`, delegating transport, streaming, structured output, error wrapping, and token accounting to the battle-tested adapter. Serves Groq-hosted open models (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-*`, `deepseek-r1-distill-llama-70b`) on LPU hardware via `.model()` and `.count()`. `GROQ_BASE_URL` / `GROQ_PROVIDER` / `GROQ_KNOWN_MODELS` exported.
- **Groq-aware capability inference** — because Groq ids are upstream open-weight names, not OpenAI's, the wrapper carries its own lists: `vision` is auto-set for `gpt-oss` / `llama-4` / `llama-3.2-*-vision`; `reasoning` for `gpt-oss` / `deepseek-r1` / `qwq` / `qwen3`. An explicit `vision` / `reasoning` / `structuredOutput` always wins. Exported as `inferVisionCapability` / `inferReasoningCapability`.
- **Default pricing registry** (USD per 1,000,000 tokens) for the known Groq models as the final fallback; resolution per-model > SDK-level `pricing[name]` > built-in default > `undefined`. No embeddings endpoint on Groq (`.embedder()` is delegated for symmetry but calls fail upstream) and no `image()`.
