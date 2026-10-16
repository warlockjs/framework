# @warlock.js/ai-groq

Groq adapter for [`@warlock.js/ai`](../ai). Groq serves open models (Llama, GPT-OSS, DeepSeek-R1 distill) fast on its LPU hardware and speaks the **OpenAI Chat Completions** wire protocol verbatim, so this package is a **thin wrapper** over [`@warlock.js/ai-openai`](../ai-openai): `GroqSDK` builds one internal `OpenAISDK` pointed at Groq's `baseURL` with `provider: "groq"` and delegates every call to it. It does not re-implement the transport, streaming, structured output, error wrapping, or token accounting.

```bash
npm install @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-groq @warlock.js/seal openai
```

> `@warlock.js/seal` is the recommended Standard Schema library for tool inputs and structured output. Any Standard Schema V1 library works (Zod, Valibot, …).

## Quick start

```ts
import { GroqSDK } from "@warlock.js/ai-groq";
import { ai } from "@warlock.js/ai";

const groq = new GroqSDK({ apiKey: process.env.GROQ_API_KEY! });

const myAgent = ai.agent({
  model: groq.model({ name: "llama-3.3-70b-versatile" }),
});

const result = await myAgent.execute("Hello!");
console.log(result.text);
```

Construct one SDK per account and reuse it everywhere — the single underlying `OpenAI` client (connection pool, auth, rate-limit state) is shared by every model it produces.

## API surface

```ts
new GroqSDK(config: GroqSDKConfig)              // = OpenAI ClientOptions + Groq baseURL/provider defaults
  .model(config: GroqModelConfig)               // → ModelContract
  .embedder(config: GroqEmbedderConfig)         // → EmbedderContract (see caveat below)
  .count(text, model?)                          // approximate token count

GroqModelConfig {
  name: string;                                 // Groq-hosted open-weight id, e.g. "llama-3.3-70b-versatile", "openai/gpt-oss-120b"
  temperature?: number;
  maxTokens?: number;
  vision?: boolean;                             // override auto-inference (gpt-oss, llama-4, llama-3.2-*-vision)
  reasoning?: boolean;                          // override auto-inference (gpt-oss, deepseek-r1, qwq, qwen3)
  structuredOutput?: boolean;                   // default true
  // ...neutral ModelConfig fields pass through
}
```

## Base URL & model families

`baseURL` defaults to `https://api.groq.com/openai/v1` (Groq's OpenAI-compatible endpoint) — override it only to route through a proxy or self-hosted gateway. `provider` defaults to `"groq"` and flows through to `ModelContract.provider`, `AgentReport.model.provider`, and logs. Every other upstream OpenAI `ClientOptions` field (`timeout`, `maxRetries`, `defaultHeaders`, `fetch`, …) is forwarded verbatim to the inner client. Both constants are exported as `GROQ_BASE_URL` and `GROQ_PROVIDER`.

A curated (not exhaustive, not an allow-list) set of current production ids is exported as `GROQ_KNOWN_MODELS`:

| Model id                                     | Notes                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| `llama-3.3-70b-versatile`                    | Flagship general-purpose text                          |
| `llama-3.1-8b-instant`                       | Fastest / cheapest small text                          |
| `openai/gpt-oss-120b` / `openai/gpt-oss-20b` | OpenAI open-weight family — vision + reasoning capable |
| `deepseek-r1-distill-llama-70b`              | DeepSeek-R1-style reasoning                            |

`name` is the upstream open-weight id (e.g. `openai/gpt-oss-120b`), NOT an OpenAI id. `groq.model()` accepts any string, so a newly launched Groq id works the moment Groq ships it.

## Capabilities

The whole reason this wrapper exists: Groq's ids aren't OpenAI's, so the OpenAI adapter's prefix inference would never fire. `GroqSDK` carries its **own** name lists and injects the result as explicit capability config, which wins over the inner adapter's inference. An explicit caller value always wins.

| Capability         | Default                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vision`           | Inferred from the Groq id — `true` for `gpt-oss`, `llama-4`, `llama-3.2-*-vision`; `false` otherwise (e.g. `llama-3.3-70b-versatile`).                                                                |
| `reasoning`        | Inferred from the Groq id — `true` for `gpt-oss`, `deepseek-r1` / `deepseek-r1-distill`, `qwq`, `qwen3`; `false` otherwise. Drives whether `reasoning.effort` maps to `reasoning_effort` on the wire. |
| `structuredOutput` | `true` — Groq accepts OpenAI-style `response_format`.                                                                                                                                                 |

```ts
groq.model({ name: "openai/gpt-oss-120b" }); // vision + reasoning auto-true
groq.model({ name: "deepseek-r1-distill-llama-70b" }); // reasoning auto-true
groq.model({ name: "some-custom-llama", vision: true }); // explicit override
```

Reasoning models accept a discrete effort knob forwarded by the inner adapter as OpenAI's `reasoning_effort`:

```ts
const model = groq.model({ name: "deepseek-r1-distill-llama-70b" });
await model.complete(messages, { reasoning: { effort: "high" } }); // → reasoning_effort: "high"
```

## Embeddings — not available on Groq

As of mid-2026 Groq exposes **no** OpenAI-compatible embeddings endpoint. `groq.embedder({ name })` constructs (delegated to the inner adapter for API symmetry) but a live `.embed()` call fails at the provider. Use [`@warlock.js/ai-openai`](../ai-openai) or `@warlock.js/ai-google` for retrieval embeddings.

## No image generation

Groq hosts no image-generation API, so `GroqSDK` intentionally does **not** expose `image()`. The structural absence of the method is the capability guard — `ai.groq.image(...)` is a compile-time error rather than a runtime failure.

## Pricing

The adapter ships built-in default rates (USD per 1,000,000 tokens) for the known Groq models as the final fallback. Supply your own `pricing` registry (keyed by model name) to win per id:

```ts
const groq = new GroqSDK({
  apiKey: process.env.GROQ_API_KEY!,
  pricing: {
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  },
});
```

Resolution at `model()` time: per-model `pricing` > SDK-level `pricing[name]` > adapter built-in default for the id > `undefined`. Built-in defaults exist for `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `deepseek-r1-distill-llama-70b`.

## Setup skill

For agent wiring, capability inference, reasoning, and pricing detail, see the bundled setup skill: [`skills/setup-groq/SKILL.md`](./skills/setup-groq/SKILL.md).

## Tests

```bash
npm test
```

Covers baseURL / provider wiring, Groq-specific vision & reasoning inference, pricing resolution, and count / embedder delegation.

## License

MIT
