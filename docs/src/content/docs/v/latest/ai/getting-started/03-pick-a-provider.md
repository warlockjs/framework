---
title: "Pick a provider"
description: Comparison across the five provider adapters — OpenAI, Anthropic, Bedrock, Google, Ollama — with a decision tree for picking one.
sidebar:
  order: 3
  label: "Pick a provider"
---

`@warlock.js/ai` is provider-agnostic. The adapters live in sibling packages. Pick by which provider(s) you want to talk to and which capabilities the model needs.

## Adapter overview

| Adapter | Status | Talks to | Best for |
| --- | --- | --- | --- |
| [`@warlock.js/ai-openai`](../providers/openai) | Shipped | OpenAI + any OpenAI-compatible gateway | Default first choice. Works against OpenAI directly or via OpenRouter / Together.ai / Azure / local gateways. |
| [`@warlock.js/ai-anthropic`](../providers/anthropic) | Shipped | Anthropic Claude API directly | Native Claude Opus / Sonnet / Haiku via the Messages API. |
| [`@warlock.js/ai-bedrock`](../providers/bedrock) | Shipped | AWS Bedrock | When AWS pricing / compliance / data residency matters more than provider choice. Converse API + Titan embeddings. |
| [`@warlock.js/ai-google`](../providers/google) | Shipped | Google Gemini directly | Gemini-specific features (long context, native multimodal), via `@google/genai`. |
| [`@warlock.js/ai-ollama`](../providers/ollama) | Shipped | Local Ollama runtime | Local models for dev, on-prem deployments, or air-gapped systems. |

All five first-party adapters ship and share the same `SDKAdapterContract`. You can also reach 100+ models through OpenRouter with the OpenAI adapter (`OpenAISDK({ baseURL: "https://openrouter.ai/api/v1" })`) when you want one key for many providers. `ai-openrouter` is intentionally deferred in favor of that path.

## Decision tree

- **Default first choice** → `@warlock.js/ai-openai` against OpenAI directly. Best support, predictable behavior, native structured output, native vision on `gpt-4o*`, embeddings, streaming.
- **Cost arbitrage across many models** → `@warlock.js/ai-openai` against OpenRouter. Same code, change the `baseURL` and `provider` fields.
- **Native Anthropic features** → `@warlock.js/ai-anthropic` (Messages API).
- **Local / self-hosted models** → `@warlock.js/ai-ollama`, or a local OpenAI-compatible gateway via the OpenAI adapter.
- **AWS Bedrock pricing / compliance** → `@warlock.js/ai-bedrock`.
- **Gemini** → `@warlock.js/ai-google`.

## The adapter contract

Every adapter implements the same `SDKAdapterContract`:

```ts
interface SDKAdapterContract {
  model(config): ModelContract;         // the provider label lives on ModelContract.provider
  count(text, model?): Promise<number>; // token counting
  embedder?(config): EmbedderContract;  // optional — not every provider supports embeddings
}
```

That's the surface your code touches. Whichever adapter you pick:

```ts
const sdk = new SomeProviderSDK({ apiKey: process.env.PROVIDER_API_KEY! });

const myAgent = ai.agent({ model: sdk.model({ name: "some-model" }) });
```

The agent factory call signature stays identical across adapters. Switching from OpenAI to Anthropic later means changing the SDK constructor and the model name — the rest of your app stays put.

## Capabilities matter

Every `ModelContract` declares what it supports — two optional flags today (absent = treat as `false`):

```ts
type ModelCapabilities = {
  structuredOutput?: boolean;   // native response_format: json_schema?
  vision?: boolean;             // can accept image attachments?
};
```

The framework reads `capabilities` to fail loud upfront. Passing `attachments: [...]` to a non-vision model throws at the boundary, not mid-trip. Adapters without native `structuredOutput` fall back to a soft "respond in JSON only" instruction.

If you fine-tuned a model or use a custom name the adapter doesn't auto-detect, override on the model call:

```ts
const customModel = openai.model({
  name: "my-org/custom-finetune",
  vision: true,
  structuredOutput: true,
});
```

## Multi-provider apps

You can run multiple adapters side by side:

```ts
const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const openrouter = new OpenAISDK({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  provider: "openrouter",
});

const fastAgent = ai.agent({ model: openai.model({ name: "gpt-4o-mini" }) });
const smartAgent = ai.agent({ model: openrouter.model({ name: "anthropic/claude-3.5-sonnet" }) });
```

Reports label per-agent provider correctly. Pricing applies per SDK instance. Cost dashboards group by `provider` field on the report.

## Related

- [Your first agent](./04-your-first-agent) — runnable walkthrough using the OpenAI adapter.
- [OpenAI adapter](../providers/openai) — full setup docs for the default adapter.
