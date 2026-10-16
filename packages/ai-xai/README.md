# @warlock.js/ai-xai

xAI **Grok** adapter for [`@warlock.js/ai`](../ai). xAI speaks the OpenAI Chat Completions protocol, so this package is a **thin wrapper** over [`@warlock.js/ai-openai`](../ai-openai)'s `OpenAISDK`: it constructs one internal `OpenAISDK` pinned to `https://api.x.ai/v1` with `provider: "xai"` and delegates `model()` / `embedder()` / `image()` / `count()` to it — while injecting xAI's own capability inference so Grok model names resolve to the right `vision` / `reasoning` flags even though they don't match OpenAI's `gpt-*` / `o*` prefixes.

```bash
npm install @warlock.js/ai @warlock.js/ai-xai @warlock.js/seal openai
```

> `@warlock.js/seal` is the recommended Standard Schema library for tool inputs and structured output. Any Standard Schema V1 library works (Zod, Valibot, …). `openai` is required because this adapter wraps `@warlock.js/ai-openai`.

## Quick start

```ts
import { XaiSDK } from "@warlock.js/ai-xai";
import { ai } from "@warlock.js/ai";

const xai = new XaiSDK({ apiKey: process.env.XAI_API_KEY! });

const myAgent = ai.agent({
  model: xai.model({ name: "grok-4" }),
});

const result = await myAgent.execute("Hello!");
console.log(result.text);
```

`apiKey` is the only required field — `baseURL` defaults to `https://api.x.ai/v1` (the xAI OpenAI-compatible endpoint) and `provider` defaults to `"xai"`. `XaiSDK` is a class holding one long-lived wrapped client; construct one per account and reuse it.

## API surface

```ts
new XaiSDK(config: XaiSDKConfig)                // = OpenAISDKConfig (baseURL/provider default to xAI)
  .model(config: XaiModelConfig)                // → ModelContract
  .embedder(config: XaiEmbedderConfig)          // → EmbedderContract
  .image(config: XaiImageConfig)                // → ImageModelContract
  .count(text, model?)                          // approximate token count

XaiModelConfig {
  name: string;                                 // e.g. "grok-4", "grok-3-mini", "grok-2-vision"
  temperature?: number;
  maxTokens?: number;
  vision?: boolean;                             // override auto-inference
  reasoning?: boolean;                          // override auto-inference
  structuredOutput?: boolean;                   // override; defaults true
  pricing?: ModelPricing;                       // per-model USD-per-1M rates
  // ...any other ModelConfig field forwarded to the wrapped OpenAI model
}
```

## Models & capabilities

Capabilities are inferred from the Grok model **name** (via `inferVisionCapability` / `inferReasoningCapability`, matched as a prefix so dated / `-latest` / `-fast` / `-beta` variants are covered) and injected as explicit flags before delegating — an explicit value always wins.

| Model           | `vision` | `reasoning`                |
| --------------- | -------- | -------------------------- |
| `grok-4`        | true     | true (reasoning-first)     |
| `grok-3`        | false    | false                      |
| `grok-3-mini`   | false    | true (the "think" variant) |
| `grok-2-vision` | true     | false                      |
| `grok-2`        | false    | false                      |

- `structuredOutput` / `promptCaching` and the image / PDF / audio wire mapping all come from the wrapped OpenAI adapter unchanged.
- `XAI_CHAT_MODELS`, `XAI_VISION_MODEL_PREFIXES`, and `XAI_REASONING_MODEL_PREFIXES` are exported for menus, validation, and docs.

```ts
xai.model({ name: "grok-4" }); // vision + reasoning auto-true
xai.model({ name: "grok-3-mini" }); // reasoning auto-true, vision false
xai.model({ name: "grok-2-vision" }); // vision auto-true
xai.model({ name: "grok-3", vision: true }); // explicit capability override
```

> Model availability changes over time — pass any current Grok id through `.model({ name })`; the prefix inference covers dated / `-latest` variants. Don't assume a model exists; check xAI's docs.

## Reasoning effort

```ts
const model = xai.model({ name: "grok-4" }); // reasoning auto-true
await model.complete(messages, { reasoning: { effort: "high" } }); // → reasoning_effort: "high"
```

`reasoning.effort` (`"low" | "medium" | "high"`) maps verbatim to the OpenAI-compatible `reasoning_effort` param and is dropped for a non-reasoning model (e.g. `grok-3`).

## Pricing

`pricing` is an optional registry keyed by model name, rates in **USD per 1,000,000 tokens** (`ModelPricing`). Resolution at `model()` time: per-model `pricing` > SDK registry > `undefined` (no cost computed).

```ts
const xai = new XaiSDK({
  apiKey,
  pricing: {
    "grok-4": { input: 3, output: 15 },
    "grok-3-mini": { input: 0.3, output: 0.5 },
  },
});
```

> Set the current xAI rates yourself — the numbers above are illustrative placeholders.

## Embeddings & images

xAI does **not** currently expose a public embeddings endpoint, so `xai.embedder({...})` is wired for protocol parity but a call to `embed()` / `embedMany()` fails upstream — use a dedicated provider (e.g. `@warlock.js/ai-openai`) for vectors. `xai.image({...})` delegates to the wrapped OpenAI Images adapter, which only recognizes the `gpt-image-*` / `dall-e-*` families and rejects any other id at construction; xAI's image generation ("Grok Imagine") is a separate surface.

## OpenAI-compatible endpoints

Override `baseURL` (proxy / gateway) or `provider` (relabel the upstream):

```ts
new XaiSDK({
  apiKey,
  baseURL: "https://gateway.internal/x.ai/v1",
  provider: "xai-proxy",
});
```

## Tests

```bash
npm test
```

Covers the wrapped-`OpenAISDK` `baseURL` / `provider` defaults and Grok capability inference.

## License

MIT
