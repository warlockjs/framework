# @warlock.js/ai-deepseek

DeepSeek adapter for [`@warlock.js/ai`](../ai). DeepSeek's API is **OpenAI-compatible** on the wire, so this package is a **thin wrapper** over [`@warlock.js/ai-openai`](../ai-openai)'s `OpenAISDK`: it constructs one internal `OpenAISDK` pinned to `https://api.deepseek.com` with `provider: "deepseek"` and delegates `model()` / `embedder()` / `image()` / `count()` to it — while injecting DeepSeek's own capability inference and built-in pricing so the right flags are set even though the model names aren't OpenAI names.

```bash
npm install @warlock.js/ai @warlock.js/ai-deepseek @warlock.js/seal openai
```

> `@warlock.js/seal` is the recommended Standard Schema library for tool inputs and structured output. Any Standard Schema V1 library works (Zod, Valibot, …). `openai` is required because this adapter wraps `@warlock.js/ai-openai`.

## Quick start

```ts
import { DeepSeekSDK } from "@warlock.js/ai-deepseek";
import { ai } from "@warlock.js/ai";

const deepseek = new DeepSeekSDK({ apiKey: process.env.DEEPSEEK_API_KEY! });

const myAgent = ai.agent({
  model: deepseek.model({ name: "deepseek-chat" }),
});

const result = await myAgent.execute("Hello!");
console.log(result.text);
```

`apiKey` is the only required field — `baseURL` defaults to `https://api.deepseek.com` (DeepSeek's OpenAI-compatible endpoint) and `provider` defaults to `"deepseek"`. `DeepSeekSDK` is a class holding one long-lived wrapped client; construct one per account and reuse it.

## API surface

```ts
new DeepSeekSDK(config: DeepSeekSDKConfig)      // Omit<OpenAISDKConfig, "baseURL" | "provider"> + optional baseURL/provider
  .model(config: DeepSeekModelConfig)           // → ModelContract
  .embedder(config: DeepSeekEmbedderConfig)     // → EmbedderContract
  .image(config: DeepSeekImageConfig)           // → ImageModelContract
  .count(text, model?)                          // approximate token count

DeepSeekModelConfig {
  name: string;                                 // e.g. "deepseek-chat", "deepseek-reasoner"
  temperature?: number;
  maxTokens?: number;
  vision?: boolean;                             // override auto-inference (always false today)
  reasoning?: boolean;                          // override auto-inference
  structuredOutput?: boolean;                   // override; defaults true
  responseFormat?: "json_schema" | "json_object" | "text";
  pdf?: boolean;                                // opt into PDF input
  audio?: boolean;                              // opt into audio input
  // ...any other ModelConfig field forwarded to the wrapped OpenAI model
}
```

## Models

| Model               | Notes                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| `deepseek-chat`     | Non-thinking surface (V3 lineage). Fast, cheap. Reasoning **off**.    |
| `deepseek-reasoner` | Thinking surface (R1 lineage). Emits a reasoning channel. Reasoning **on**. |
| `deepseek-v4-flash` | Newer flash tier. Reasoning **off** by default.                       |
| `deepseek-v4-pro`   | Newer quality tier. Reasoning **on** by default.                      |

DeepSeek announced the legacy `deepseek-chat` / `deepseek-reasoner` names retire 2026/07/24 in favor of the `deepseek-v4-*` family; both name sets are understood by the capability inference. `deepseek.model({ name })` accepts any id the upstream serves. `DEEPSEEK_CHAT_MODELS` exports the informational list.

## Capabilities

Capabilities are inferred from the DeepSeek model **name** (via `inferReasoningCapability` / `inferVisionCapability`) and injected as explicit flags before delegating — an explicit value always wins.

| Capability         | Default                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `reasoning`        | `true` for `deepseek-reasoner` and the `*-pro` tier; `false` for `deepseek-chat` / `*-flash`. |
| `vision`           | `false` for every DeepSeek model — no chat model documents image input (mid-2026).      |
| `structuredOutput` | `true` (inherited from the wrapped OpenAI model), unless `responseFormat` forces a loose mode. |
| `promptCaching`    | `true` (inherited). DeepSeek reports cache hits via `usage.cachedTokens`.                |

```ts
deepseek.model({ name: "deepseek-chat", reasoning: true });     // force the thinking flag
deepseek.model({ name: "deepseek-reasoner", reasoning: false }); // suppress it
```

## Reasoning effort

```ts
const model = deepseek.model({ name: "deepseek-reasoner" });        // reasoning auto-true
await model.complete(messages, { reasoning: { effort: "high" } });  // → reasoning_effort: "high"
```

`reasoning.effort` maps to the OpenAI-compatible `reasoning_effort` param and is dropped for a non-reasoning model.

## Pricing

The adapter ships **built-in DeepSeek pricing defaults** (USD per 1M tokens, from DeepSeek's published table), so `usage.cost` is computed out of the box. Resolution at `model()` time: per-model `pricing` > SDK `pricing` registry > built-in DeepSeek default > `undefined`.

```ts
new DeepSeekSDK({
  apiKey,
  pricing: { "deepseek-reasoner": { input: 0.55, output: 2.19 } },
});
```

## Embeddings & images

`deepseek.embedder({...})` and `deepseek.image({...})` delegate to the wrapped `OpenAISDK`. **DeepSeek does not officially document an OpenAI-compatible embeddings endpoint or an image-generation endpoint (mid-2026)** — these delegates exist for adapter parity and work against a compatible gateway you point `baseURL` at, but may fail against the stock DeepSeek endpoint. Use a dedicated embeddings provider (e.g. `@warlock.js/ai-openai` / `@warlock.js/ai-google`) for RAG.

## OpenAI-compatible endpoints

Override `baseURL` (proxy / gateway) or `provider` (relabel the upstream):

```ts
new DeepSeekSDK({
  apiKey,
  baseURL: "https://my-gateway.example.com/deepseek",
  provider: "deepseek-proxy",
});
```

## Tests

```bash
npm test
```

Covers DeepSeek capability inference and the thin-wrapper delegation to `OpenAISDK`.

## License

MIT
