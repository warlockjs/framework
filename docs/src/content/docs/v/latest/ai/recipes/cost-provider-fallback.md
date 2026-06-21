---
title: "Recipe — Provider fallback across OpenAI and Anthropic"
description: Wrap an ordered model list with ai.fallbackModel so rate-limits and timeouts on the primary transparently fail over to a backup provider.
sidebar:
  order: 12
  label: "Provider fallback"
---

> **Scenario.** Your agent runs on OpenAI. During a regional incident OpenAI starts returning 429s and timeouts, and every customer request fails. You want the agent to transparently fail over to Anthropic for the duration of the blip — without retrying on errors that would fail identically downstream (a bad API key, an oversized prompt, a content-filter block), since those only burn the backup's budget too.
>
> `ai.fallbackModel` is a drop-in `ModelContract` that wraps an ordered list of models and advances to the next one only on a transient provider error. Hand it to any agent in place of a single model and the fall-over is invisible to the rest of your code.

## Wire the fallback chain

Construct one SDK instance per provider, then order the models primary-first. The wrapper fronts the primary model's identity, capabilities, and pricing for its whole lifetime.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: { "gpt-4o": { input: 2.5, output: 10 } },
});

const anthropic = new AnthropicSDK({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  pricing: { "claude-sonnet-4-6": { input: 3, output: 15 } },
});

// Tries OpenAI first; on a transient provider error, falls over to Anthropic.
const resilientModel = ai.fallbackModel([
  openai.model({ name: "gpt-4o" }),
  anthropic.model({ name: "claude-sonnet-4-6" }),
]);

const agent = ai.agent({
  model: resilientModel,
  systemPrompt: ai.systemPrompt().instruction("Answer the support question concisely."),
});
```

## What the default fails over on — and what it doesn't

With no `retryOn`, the chain advances only on the built-in transient set:

| Code | Falls over? | Why |
|---|---|---|
| `PROVIDER_RATE_LIMIT` | yes | 429 — the backup likely has headroom |
| `PROVIDER_TIMEOUT` | yes | slow upstream — try a different one |
| `PROVIDER_ERROR` | yes | generic 5xx / network failure |
| `PROVIDER_AUTH` | **no** | a bad key fails identically downstream |
| `CONTEXT_LENGTH_EXCEEDED` | **no** | an oversized prompt fails on every model |
| `CONTENT_FILTER` | **no** | a blocked prompt is blocked everywhere |
| `PROVIDER_INVALID_REQUEST` | **no** | a malformed request fails everywhere |

Non-transient failures re-throw immediately with their original typed `AIError` — falling over on them only burns the backup's budget on input that fails the same way.

## Run it and inspect what was burned

`execute()` never throws — a success on any model in the chain returns normally, and the usage is aggregated across every model that was attempted. When the whole chain is exhausted, the final model's error surfaces on `result.error`.

```ts
const result = await agent.execute("How do I reset my password?", {
  sessionId: tenantId,
});

if (result.error) {
  // Every model in the chain failed. The error is the LAST model's, with
  // its original code preserved.
  logger.error("fallback chain exhausted", {
    code: result.error.code,
    category: result.error.category,
  });
  throw result.error;
}

// Which providers were burned before we got an answer? Empty when the
// primary succeeded outright; one entry per failed-over model otherwise.
for (const attempt of resilientModel.lastAttempts) {
  metrics.increment("ai.provider.failover", {
    from: attempt.provider,
    model: attempt.modelName,
  });
}

return result.text;
```

`lastAttempts` is a `FallbackAttempt[]` (`{ modelName, provider, error }`), overwritten on each call — read it right after the `execute()` that produced it.

## Narrow or widen the retry policy

`retryOn` is additive over the default. Pass an explicit `AIErrorCode[]` to pin exactly which codes fail over — for example, rate-limit and timeout only, treating generic 5xx as fatal:

```ts
const rateLimitAndTimeoutOnly = ai.fallbackModel(
  [openai.model({ name: "gpt-4o" }), anthropic.model({ name: "claude-sonnet-4-6" })],
  { retryOn: ["PROVIDER_RATE_LIMIT", "PROVIDER_TIMEOUT"] },
);
```

Or pass a predicate for arbitrary branching — e.g. fall over on any rate-limit, but only on timeouts after the provider has been slow for a while:

```ts
import { ProviderRateLimitError, ProviderTimeoutError } from "@warlock.js/ai";

const smartFallback = ai.fallbackModel(
  [openai.model({ name: "gpt-4o" }), anthropic.model({ name: "claude-sonnet-4-6" })],
  {
    retryOn: (error) =>
      error instanceof ProviderRateLimitError ||
      error instanceof ProviderTimeoutError,
  },
);
```

## Three-deep chains and cost arbitrage

The list takes any number of models, tried in order. A common shape is cheap-primary, premium-backup, different-provider-last — the chain only reaches the expensive model when the cheap ones are genuinely down:

```ts
const tieredModel = ai.fallbackModel([
  openai.model({ name: "gpt-4o-mini" }),       // cheap, tried first
  openai.model({ name: "gpt-4o" }),            // same provider, more capable
  anthropic.model({ name: "claude-sonnet-4-6" }), // different provider, last resort
]);
```

Each successful call's usage is aggregated across every model attempted, and cost merges per channel — an unpriced model in the chain never erases a priced one's cost in the rolled-up `usage.cost`.

## Production notes

:::caution[Streaming can only fail over before the first chunk]
`stream()` advances to the next model only while no chunk has been emitted yet. Once the first `delta` / `tool-call` reaches the consumer, the partial output can't be un-sent, so a mid-stream failure propagates instead of restarting on the backup. If resilient streaming matters more than first-token latency, buffer the stream behind a non-streaming `execute()` for the fallback-critical path.
:::

:::note[Fall-over is instant — pair with backoff for rate-limits]
`fallbackModel` advances to the next model immediately; it owns no retry/backoff timing of its own. For a rate-limit you often want to retry the SAME provider after `error.retryAfter` ms before giving up on it — that's a backoff middleware's job, layered around the agent. Use `fallbackModel` for "try a different provider," a backoff for "wait and retry this one."
:::

:::note[The wrapper fronts the primary's pricing]
`fallbackModel` exposes the primary model's `pricing`, `capabilities`, and `name` as its own identity. Cost on a failed-over run is still computed per-attempt from each model's real pricing and aggregated — but if you read `model.pricing` off the wrapper directly, you're seeing the primary's table. Configure pricing on each underlying SDK so every attempted provider prices its own tokens correctly.
:::

## Related

- [Pick a provider](../getting-started/03-pick-a-provider) — one SDK per provider, capabilities, and `ModelPricing`.
- [Handle errors](../digging-deeper/handle-errors) — the `AIErrorCode` union and which codes are transient.
- [Cost per tenant](./cost-aggregate-per-tenant) — aggregating the usage a failed-over run still reports.
