# WR-035 — Pre-call cost estimate for every adapter (small gap; cost reporting already exists)

- **Packages:** `@warlock.js/ai-openai`, `@warlock.js/ai-google` (and other adapters) 5.30.0
- **Classification:** small feature request (related: WR-030)
- **Found:** 2026-10-17. Correction: an earlier draft of this note overstated the gap. Model pricing is
  configurable per model and every agent result already reports cost (input, output and cache) for all
  vendors.

## What is missing

- **`countTokens()` exists only on `AnthropicModel`.** An app that wants to refuse a call before sending it
  (for example "this prompt would exceed the owner's per-call cap") cannot count input tokens for OpenAI,
  Google, Bedrock and others. A documented estimate (characters ÷ a per-model ratio) would also do.
- **Billing fact on provider errors.** Errors don't carry a `billed: boolean | "unknown"` fact. A host has to
  parse provider bodies to know that a 401/402/403, or an unacknowledged 429, cost nothing.

## Request

- `countTokens(messages, options?)` (or `estimateInputTokens`) on every chat model adapter.
- `ProviderError.billed` on the typed provider errors.

## Additional requests (2026-10-17 harness review)

- `budget` books usage only after each trip, so a single trip can overrun a cap. Add an optional
  reserve-then-commit mode using the estimate above, with a scoped store holding it atomically.
- Add `status` (the HTTP status) to `ProviderError`, and give overloaded/529 its own code with `retryable: true`.
- `budget`'s own pricing (`inputPer1K` / `outputPer1K`) is a second shape that ignores cache. Accept
  `ModelPricing` (and its cache rates, see WR-037) there too.
