# WR-037 — `computeCost` under-reports Anthropic cost (cache reads double-subtracted, cache writes free)

- **Packages:** `@warlock.js/ai` 5.30.0 (`utils/compute-cost.ts`), `@warlock.js/ai-anthropic` 5.30.0 (`model.ts` usage mapping)
- **Classification:** confirmed bug
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

- `ai-anthropic` sets `usage.input = usage.input_tokens`, `usage.cachedTokens = cache_read_input_tokens` and `usage.cacheWriteTokens = cache_creation_input_tokens` (model.ts ~400-430).
- Anthropic's `input_tokens` **excludes** cache reads and cache writes. OpenAI's `prompt_tokens` **includes** cached tokens.
- `computeCost` assumes the OpenAI semantics: it bills `input - cachedTokens` at the input rate and `cachedTokens` at `cachedInput`. For Anthropic that subtracts cache reads that were never in `input`, and can floor fresh input at 0.
- `cacheWriteTokens` is never charged. The `cachedOutput` channel is "reserved" but nothing fills it, and 1-hour cache writes (2x input) and 5-minute writes (1.25x) are not distinguished.

## Repro

A response with `input_tokens: 100`, `cache_read_input_tokens: 50_000`, `cache_creation_input_tokens: 20_000`, `output_tokens: 500`, at pricing `{ input: 3, output: 15, cachedInput: 0.3 }`. The true cost is 100×3 + 50,000×0.3 + 20,000×3.75 + 500×15. `computeCost` returns fresh input 0, cache read 50,000×0.3, no write cost.

## Request

- A per-adapter flag on usage, e.g. `Usage.inputIncludesCache: boolean` (OpenAI true, Anthropic false), honoured by `computeCost`.
- `ModelPricing.cacheWrite` (or `cacheWrite5m` / `cacheWrite1h`) and a cost channel for writes. The adapter knows which TTL it requested.
- A spec using a recorded Anthropic usage block with both cache read and write.

## Related (2026-10-17)

The `Usage` type doc says `input` includes `cachedTokens`, while the Anthropic and Bedrock adapters report `input`
without cache reads or writes. Either normalise in the adapters or add `Usage.inputIncludesCache`, and make the type
doc match.
