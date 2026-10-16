# @warlock.js/ai-mistral

Mistral AI adapter for [`@warlock.js/ai`](../ai). Mistral exposes an **OpenAI-compatible** Chat Completions + Embeddings API, so this package is a **thin wrapper** over [`@warlock.js/ai-openai`](../ai-openai): `MistralSDK` builds one internal `OpenAISDK` pointed at Mistral's `baseURL` with `provider: "mistral"` and delegates every call to it. It does not re-implement the wire protocol, streaming, tool-call accumulation, structured output, error wrapping, or token accounting.

```bash
npm install @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-mistral @warlock.js/seal openai
```

> `@warlock.js/seal` is the recommended Standard Schema library for tool inputs and structured output. Any Standard Schema V1 library works (Zod, Valibot, …).

## Quick start

```ts
import { MistralSDK } from "@warlock.js/ai-mistral";
import { ai } from "@warlock.js/ai";

const mistral = new MistralSDK({ apiKey: process.env.MISTRAL_API_KEY! });

const myAgent = ai.agent({
  model: mistral.model({ name: "mistral-large-latest" }),
});

const result = await myAgent.execute("Hello!");
console.log(result.text);
```

Construct one SDK per account and reuse it everywhere — the single underlying `OpenAI` client (connection pool, auth, rate-limit state) is shared by every model and embedder it produces.

## API surface

```ts
new MistralSDK(config: MistralSDKConfig)        // = OpenAI ClientOptions + provider/pricing defaults
  .model(config: MistralModelConfig)            // → ModelContract
  .embedder(config: EmbedderConfig)             // → EmbedderContract
  .count(text, model?)                          // approximate token count

MistralModelConfig {
  name: string;                                 // e.g. "mistral-large-latest", "magistral-medium-latest"
  temperature?: number;
  maxTokens?: number;
  vision?: boolean;                             // override auto-inference (pixtral family, recent generations)
  reasoning?: boolean;                          // override auto-inference (magistral family, hybrid mistral-small)
  structuredOutput?: boolean;
  responseFormat?: "json_schema" | "json_object" | "text";
  pdf?: boolean;                                // opt into PDF document input (default false)
  audio?: boolean;                              // opt into audio input (default false)
  // ...neutral ModelConfig fields pass through
}
```

## Base URL & model families

`baseURL` defaults to `https://api.mistral.ai/v1` (Mistral's OpenAI-compatible endpoint serving `/chat/completions` and `/embeddings`). Override it only to reach a Mistral-compatible gateway or proxy. `provider` defaults to `"mistral"` and flows through to `ModelContract.provider`, `AgentReport.model.provider`, and logs. Every other upstream OpenAI `ClientOptions` field (`timeout`, `maxRetries`, `defaultHeaders`, `fetch`, …) is forwarded verbatim.

The headline `-latest` aliases are exported as `MISTRAL_MODELS`, grouped by role:

| Family      | Aliases                                                                 | Notes                                             |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `chat`      | `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest` | General-purpose multimodal flagship / mid / small |
| `vision`    | `pixtral-large-latest`, `pixtral-12b`                                   | Dedicated multimodal (image input)                |
| `reasoning` | `magistral-medium-latest`, `magistral-small-latest`                     | Chain-of-thought reasoning                        |
| `embedding` | `mistral-embed`                                                         | Via the OpenAI-compatible `/v1/embeddings`        |

`mistral.model()` accepts any id string, so version-pinned ids (`mistral-large-2512`, `magistral-medium-2509`) work just as well — capability inference keys off the family fragment, not the alias list.

## Capabilities

The wrapper injects **Mistral-aware** capability inference before delegating to the OpenAI adapter, because the OpenAI prefix lists (`gpt-4o`, `o3`, …) never match Mistral names. An explicit value always wins over inference.

| Capability         | Default                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vision`           | Inferred from the model name — `true` for the `pixtral` family and the recent multimodal generations (`mistral-large`, `mistral-medium`, `ministral-3`); `false` otherwise.                              |
| `reasoning`        | Inferred from the model name — `true` for the `magistral` family and the hybrid `mistral-small` generation; `false` otherwise. Drives whether `reasoning.effort` maps to `reasoning_effort` on the wire. |
| `structuredOutput` | `true`, unless `responseFormat` is forced to `"json_object"` / `"text"`.                                                                                                                                 |

```ts
mistral.model({ name: "pixtral-large-latest" }); // vision auto-true
mistral.model({ name: "magistral-medium-latest" }); // reasoning auto-true
mistral.model({ name: "some-fine-tune", vision: true }); // explicit override
```

## Embeddings

`mistral-embed` is served through the OpenAI-compatible `/v1/embeddings`, so the embedder delegates straight to the wrapped OpenAI embedder:

```ts
const embedder = mistral.embedder({ name: "mistral-embed" });

const { vector, dimensions, usage } = await embedder.embed("Hello world");
const { vectors } = await embedder.embedMany(["doc 1", "doc 2"]);
```

## Pricing

The adapter ships a conservative default registry (`MISTRAL_DEFAULT_PRICING`, USD per 1,000,000 tokens) so cost truth works out of the box. Supply your own `pricing` to win per model id:

```ts
const mistral = new MistralSDK({
  apiKey: process.env.MISTRAL_API_KEY!,
  pricing: {
    "mistral-large-latest": { input: 2, output: 6 },
    "magistral-medium-latest": { input: 2, output: 5 },
  },
});
```

Resolution at `model()` time: per-model `pricing` > SDK-level `pricing` > `MISTRAL_DEFAULT_PRICING` > `undefined`. The defaults are list-price approximations — pass explicit rates for billing-grade numbers.

## No image generation

Mistral has no OpenAI-compatible image endpoint, so `MistralSDK` intentionally does **not** expose `image()`. The structural absence of the method is the capability guard — `ai.mistral.image(...)` is a compile-time error rather than a runtime failure.

## Setup skill

For agent wiring, capability inference, and pricing detail, see the bundled setup skill: [`skills/setup-mistral/SKILL.md`](./skills/setup-mistral/SKILL.md).

## Tests

```bash
npm test
```

Covers baseURL / provider wiring, Mistral-aware vision & reasoning inference, pricing resolution, and embedder / count delegation.

## License

MIT
