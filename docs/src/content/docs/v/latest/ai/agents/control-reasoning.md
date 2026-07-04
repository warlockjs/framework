---
title: "Control reasoning"
description: The neutral reasoning option, the per-model reasoning capability override, and how each of the five adapters maps effort / maxTokens onto its provider-native thinking control.
sidebar:
  order: 3
  label: "Control reasoning"
---

Reasoning-capable models (OpenAI o-series / `gpt-5*`, Claude 3.7 / 4, Gemini 2.5, thinking-capable Ollama tags) accept an extra per-call hint. `@warlock.js/ai` exposes it as one vendor-neutral option and each adapter translates it to its own provider-native control. An adapter whose `capabilities.reasoning` is false **ignores** the option rather than forwarding an unsupported parameter — so the same call is safe to send to any model.

## The neutral option

`ModelCallOptions.reasoning` carries two optional knobs:

```ts
reasoning?: {
  effort?: "low" | "medium" | "high";   // ReasoningEffort — a coarse dial
  maxTokens?: number;                    // explicit thinking-token budget
};
```

- `effort` is the portable dial — it maps cleanly to every provider.
- `maxTokens` caps the thinking budget directly. Providers that budget by token count honor it; providers that only expose a discrete effort knob ignore it.

Pass it through `modelOptions` when running an agent, or directly to a model's `complete()` / `stream()`:

```ts
await myAgent.execute(input, {
  modelOptions: {
    reasoning: { effort: "high" },
  },
});

// Or straight at the model:
await model.complete(messages, { reasoning: { maxTokens: 8192 } });
```

The resulting reasoning-token count flows back through `usage.reasoningTokens` — for the providers that report one (see below).

## The per-model `reasoning` override

Each adapter infers whether a model is reasoning-capable from its name. The per-model `reasoning` flag overrides that inference — useful for proxied deployments, fine-tunes, or gateways that expose reasoning under a custom name:

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// Force-enable on a gateway model the name-prefix list doesn't recognize:
openai.model({ name: "my-proxy/o3-custom", reasoning: true });

// Opt a target out when it 400s on the thinking/reasoning param:
openai.model({ name: "legacy-target", reasoning: false });
```

Setting it explicitly always wins over inference. When the resolved capability is `false`, the adapter drops any `reasoning` call option on the floor instead of sending an unsupported field.

The same flag lives on every adapter's per-model config: `OpenAIModelConfig`, `AnthropicModelConfig`, `BedrockModelConfig`, `GoogleModelConfig`, and `OllamaModelConfig`. (The override is accepted inline by `model({...})` on all five; the standalone `OpenAIModelConfig` type is internal to `@warlock.js/ai-openai`, so pass the object literal directly rather than importing the type.)

## How each adapter maps the option

| Adapter | Wire field | `effort` → | `maxTokens` → | Reports `reasoningTokens`? |
| --- | --- | --- | --- | --- |
| **OpenAI** | `reasoning_effort` | passed through (`"low"`/`"medium"`/`"high"`) | **ignored** — Chat Completions has no token budget | Yes — `completion_tokens_details.reasoning_tokens` |
| **Anthropic** | `thinking: { type: "enabled", budget_tokens }` | bucketed to a token budget | used directly (floored at 1024) | No — thinking tokens billed inside `output` |
| **Bedrock** | `additionalModelRequestFields.thinking` | bucketed to a token budget | used directly | No — Converse `TokenUsage` has no reasoning channel |
| **Google** | `thinkingConfig.thinkingBudget` | bucketed to a token budget | used directly as the cap | Yes — `thoughtsTokenCount` |
| **Ollama** | `think` request flag | passed through (`"low"`/`"medium"`/`"high"`); effort-less → `true` | **ignored** — the daemon takes no token cap | No — thinking surfaces as a string, not a count |

Resolution rule for the budget-based adapters (Anthropic / Bedrock / Google): an explicit `reasoning.maxTokens` wins; otherwise `effort` is bucketed to a representative budget; if neither is set, no thinking field is emitted (provider default).

### Effort → budget buckets

When you give `effort` but no explicit `maxTokens`, the budget-based adapters translate the level to these token budgets:

| `effort` | OpenAI | Anthropic | Bedrock | Google |
| --- | --- | --- | --- | --- |
| `"low"` | `reasoning_effort: "low"` | 1024 | 1024 | 1024 |
| `"medium"` | `reasoning_effort: "medium"` | 4096 | 4096 | 8192 |
| `"high"` | `reasoning_effort: "high"` | 12000 | 16384 | 24576 |

OpenAI and Ollama have no budget column — they forward the `effort` enum verbatim.

:::note
Anthropic rejects an extended-thinking budget below **1024** tokens, so any resolved Anthropic budget — including a small explicit `maxTokens` — is floored at 1024 before it reaches the wire. Anthropic also drops `temperature` when thinking is enabled (the API 400s on `temperature` alongside `thinking`).
:::

## When the model isn't reasoning-capable

```ts
const gpt4o = openai.model({ name: "gpt-4o" }); // capabilities.reasoning === false

// The reasoning hint is silently dropped — no reasoning_effort on the wire,
// no error. The same call works against o3 (which honors it).
await gpt4o.complete(messages, { reasoning: { effort: "high" } });
```

This is the whole point of the neutral option: you write the agent once and let capability inference decide whether the hint is forwarded. The `reasoning` per-model flag only changes *which* models count as capable.

:::tip
Reading `reasoningTokens` back matters for cost. OpenAI and Google bill (and report) the thinking phase as a distinct token channel, so `usage.reasoningTokens` is populated and `ModelPricing.reasoning` (USD per 1M) prices it separately. Anthropic and Bedrock fold thinking into `output` tokens, so there is no separate count — they price under the normal `output` rate.
:::

## Related

- [Run agent](/v/latest/ai/agents/run-agent/) — passing `modelOptions.reasoning` per execute.
- [Pick a provider](/v/latest/ai/getting-started/03-pick-a-provider/) — the `ModelCapabilities` flags each adapter advertises.
- [Observability and cost truth](/v/latest/ai/best-practices/observability-and-cost-truth/) — where `reasoningTokens` and reasoning cost surface in reports.
- [OpenAI provider](/v/latest/ai/providers/openai/) · [Anthropic provider](/v/latest/ai/providers/anthropic/) · [Bedrock provider](/v/latest/ai/providers/bedrock/) · [Google provider](/v/latest/ai/providers/google/) · [Ollama provider](/v/latest/ai/providers/ollama/)
