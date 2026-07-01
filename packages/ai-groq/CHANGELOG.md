# Changelog — @warlock.js/ai-groq

All notable changes to `@warlock.js/ai-groq` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Added

- **First release.** `GroqSDK` — a thin wrapper over `@warlock.js/ai-openai` that points one internal `OpenAISDK` at Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`) with `provider: "groq"`, delegating transport, streaming, structured output, error wrapping, and token accounting to the battle-tested adapter. Serves Groq-hosted open models (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-*`, `deepseek-r1-distill-llama-70b`) on LPU hardware via `.model()` and `.count()`. `GROQ_BASE_URL` / `GROQ_PROVIDER` / `GROQ_KNOWN_MODELS` exported.
- **Groq-aware capability inference** — because Groq ids are upstream open-weight names, not OpenAI's, the wrapper carries its own lists: `vision` is auto-set for `gpt-oss` / `llama-4` / `llama-3.2-*-vision`; `reasoning` for `gpt-oss` / `deepseek-r1` / `qwq` / `qwen3`. An explicit `vision` / `reasoning` / `structuredOutput` always wins. Exported as `inferVisionCapability` / `inferReasoningCapability`.
- **Default pricing registry** (USD per 1,000,000 tokens) for the known Groq models as the final fallback; resolution per-model > SDK-level `pricing[name]` > built-in default > `undefined`. No embeddings endpoint on Groq (`.embedder()` is delegated for symmetry but calls fail upstream) and no `image()`.
