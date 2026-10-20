# Changelog — @warlock.js/ai-ollama

All notable changes to `@warlock.js/ai-ollama` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.34.3

### Changed

- The agent skill now exports as `warlock-js-ai-ollama`; package discovery descriptions stay within 450 characters.

## 5.34.2 - 2026-10-19

### Fixed

- Replace the loose skill catalog with a package index that points to the provider setup topic, and include orientation in generated LLM projections.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Fixed

- `complete()` now honours `signal`: the `ollama` client takes no per-request signal, so `OllamaSDK` wraps the client's `fetch` (the caller's own `fetch` option included) to apply each call's signal. Aborting cancels the HTTP request before or after the response starts, on `complete()` and `stream()`, and a call with an already-aborted signal rejects without sending a request. An adapter contract test covers both calls.
- Provider body options merge plain-object fields one level deep, preserving neutral reasoning, generation and structured-output settings unless the caller overrides their keys.

### Added

- `complete()` and the streaming `done` chunk attach `usage.cost` when the model is given `pricing`.
- With `streamChunks`, `stream()` yields `reasoning` for each `message.thinking` piece. Provider-defined tools for other providers are left out of the request with a warning.
- `providerOptions.ollama.body` forwards native per-call request options for completions and streams while protecting the model, conversation and tool definitions.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.26.0 - 2026-09-30

### Changed

- Clamp neutral reasoning effort levels to Ollama's supported `think` literals.

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

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
