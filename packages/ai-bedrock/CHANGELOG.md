# Changelog — @warlock.js/ai-bedrock

All notable changes to `@warlock.js/ai-bedrock` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.3.0 - 2026-06-21

### Added

- **Cost-truth capabilities** — `reasoning`, `promptCaching`, `pdf`, and `audio` are reported truthfully per model family (inferred from the model id, overridable via `bedrock.model(...)`).
- **Reasoning / extended thinking** — `ModelCallOptions.reasoning` maps to Converse `thinking` for reasoning-capable models, and no-ops elsewhere so unsupported params never reach the wire.
- **Prompt-cache write breakpoints** — `cacheControl.breakpoints` appends a Converse `cachePoint` block for caching-capable models.
- **`Usage.cacheWriteTokens`** populated from Converse `cacheWriteInputTokens`; `reasoningTokens` is left unset (Bedrock reports no reasoning channel).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
