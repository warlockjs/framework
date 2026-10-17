# WR-045 — Cache coverage for OpenAI-compatible and Bedrock, and built-in price tables

- **Packages:** `@warlock.js/ai-openai`, `@warlock.js/ai-bedrock`, `@warlock.js/ai-deepseek`, `@warlock.js/ai-xai`, `@warlock.js/ai-groq`, `@warlock.js/ai-google` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

- OpenAI-compatible wrappers (DeepSeek and others through `baseURL`) send no cache hints, only reading cached-token usage.
- Bedrock marks a `cachePoint` on the last message only, not on system or tools.
- Built-in price tables exist only for some adapters. Anthropic, OpenAI and Google pricing is opt-in, so every app ships and maintains its own table.

## Request

- Pass `prompt_cache_key` / retention where the compatible endpoint supports it.
- Bedrock `cachePoint` on system and tools.
- Maintained `knownModels` price tables (input, output, cache read, cache write) for every adapter, overridable per app.
