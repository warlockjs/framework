---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Generate images"
description: ai.image is the text-to-image output verb — prompt in, images out, in the same never-throws { data, error, usage, report } envelope every AI verb returns.
sidebar:
  order: 1
  label: "Generate images"
---

`ai.image()` is the output counterpart to [`ai.agent`](/v/v4/ai/agents/run-agent/) for the image modality. Prompt-in / images-out, wrapped in the **same** uniform result contract every AI verb returns — so an image generation slots into your cost dashboards and observability traces exactly like an agent run.

This is image **output** (generation). For image or PDF **input** to a chat agent (vision), see [Run agent](/v/v4/ai/agents/run-agent/).

## The core API

You build an image model from an adapter's `image()` factory, then run the verb. It never throws — provider faults land on `result.error`.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.image({ name: "gpt-image-1" }); // ImageModelContract

const { data, error, usage, report } = await ai.image({
  model,
  prompt: "a red bicycle leaning on a brick wall",
});

if (error) {
  console.warn(error.code); // typed AIError (auth / rate-limit / content-filter / …)
} else {
  for (const img of data.images) {
    if (img.type === "base64") {
      save(Buffer.from(img.base64, "base64"), img.mediaType);
    } else {
      download(img.url);
    }
  }
}
```

`ImageModelContract` is a peer primitive on the SDK adapter, produced by the optional `image?()` factory — the same shape as `EmbedderContract`. An adapter without an image API simply doesn't define `image()`, so calling it on an unsupported adapter is a **compile-time** error, not a silent runtime failure.

:::tip
No adapter validates the model id locally. `openai.image({ name })` (and every other provider's `image()`) forwards the id to the provider exactly as given, so an id the provider does not serve fails as a typed provider error on `result.error` — never as a local throw at construction.
:::

## The result envelope

Every AI verb returns the same discriminated envelope. For images:

```ts
type ImageResult = {
  type: "image";
  data?: { images: GeneratedImage[] }; // undefined on failure
  error?: AIError;                     // undefined on success — NEVER thrown
  usage: Usage;                        // tokens (gpt-image) + cost when priced
  report: ImageReport;                 // type:"image", model, imageCount, lineage
};

type GeneratedImage =
  | { type: "base64"; base64: string; mediaType: string; revisedPrompt?: string }
  | { type: "url"; url: string; mediaType?: string; revisedPrompt?: string };
```

`GeneratedImage` is a discriminated union — always branch on `img.type` rather than assuming `base64`. `gpt-image-1` always returns base64 bytes; DALL·E can return either depending on the request.

## Generation options

The options are provider-neutral. Each adapter maps the ones its API supports and ignores the rest; `options` is the escape hatch for provider-specific knobs.

```ts
await ai.image({
  model,
  prompt: "an isometric office desk, soft studio lighting",
  count: 2,             // n images
  size: "1024x1024",    // OpenAI WxH (also resolves per-size pricing)
  quality: "high",      // OpenAI quality tier
  aspectRatio: "16:9",  // Imagen ratio
  negativePrompt: "blurry, watermark", // Imagen
  format: "png",        // output container hint
  signal,               // AbortSignal
  observe: collector,   // route the report to an Observer
  sessionId: "checkout-123",
  options: { background: "transparent" }, // provider-specific passthrough
});
```

## OpenAI — gpt-image (token-metered) + DALL·E (per-image)

```ts
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// gpt-image-1 always returns base64 bytes; priced per TOKEN.
const gpt = openai.image({ name: "gpt-image-1", pricing: { input: 5, output: 40 } });

// DALL·E 3 — per-image pricing; defaults to base64 (opt into url with options).
const dalle = openai.image({ name: "dall-e-3", pricing: { perImage: 0.04 } });
```

## Google — Imagen (per-image) and Gemini (per-token)

```ts
import { GoogleSDK } from "@warlock.js/ai-google";

const google = new GoogleSDK({ apiKey: process.env.GEMINI_API_KEY! });

// Imagen — routes to ai.models.generateImages; reports no tokens.
const imagen = google.image({
  name: "imagen-4.0-generate-001",
  pricing: { perImage: 0.04 },
});

// Gemini image model — routes to ai.models.generateContent; usage passed through.
const gemini = google.image({
  name: "gemini-3.1-flash-lite-image",
  pricing: { input: 0.3, output: 30 },
});

const { data } = await ai.image({
  model: imagen,
  prompt: "a watercolor lighthouse at dawn",
  aspectRatio: "3:4",
});
```

The **id picks the transport**: a `gemini-` id goes to `generateContent` with `responseModalities` including `"IMAGE"`, anything else to `generateImages`. Both surface images in the same `GeneratedImage` shape (base64 bytes, no hosted URL). They differ in usage: Imagen always reports `{ input: 0, output: 0, total: 0 }`, while the Gemini path passes through whatever `usageMetadata` Google attaches — so price the first with `{ perImage }` and the second with `{ input, output }`.

When Google filters the request, `ai.image` surfaces a typed `ContentFilterError` on `result.error` — no exception to catch. On the Gemini path, a response that came back as text instead of an image surfaces a `ProviderError` quoting that text, never a silent empty success.

Like every adapter, Google does **not** guard the model id: the id selects a route, it is never refused locally, so an id Google does not serve fails as a typed provider error on `result.error` — not with a local throw at construction. See the [Google provider page](/v/v4/ai/providers/google/).

:::caution[The Gemini image path: what is measured vs what is reported]
No test calls the live API, so the evidence comes in two tiers. **Measured here:** a `gemini-*` image id that returns `404 … is not supported for predict` on the Imagen transport reached the model on `generateContent` and came back with a quota error (HTTP 429) — the endpoint accepts the id. **Reported by the maintainer:** with billing enabled on the project, an image came back end-to-end from an application running a locally linked build. **Still unknown:** whether these models report token usage — no `usageMetadata` from a successful image call has been seen, so verify `usage` against your own model before relying on `{ input, output }` pricing.
:::

Google has **deprecated `generateImages`**, the transport behind the `imagen-*` path: *"The generateImages method is deprecated and will be removed in the next major release (not before Jan. 1 2027). Please use the generateContent method with image models instead."* Nothing breaks today, but prefer a `gemini-` id for new work.

## Cost-truth — one rollup, two metering models

`ai.image` fills `usage.cost` (a USD breakdown) so image spend folds into the **same** `Usage.cost` rollup as text — there's no second accounting path:

- **Token-metered** (`gpt-image-1`): `{ input, output }` USD-per-1M-tokens against the returned token usage.
- **Per-image** (DALL·E, Imagen): `{ perImage }` (or `perImageBySize["1792x1024"]`) × image count → `cost.output`.

An unpriced model leaves `usage.cost` **`undefined`** — an honest "cost unknown", never a false zero. A pre-priced adapter response is honored, not overwritten.

## Real-world — catalog thumbnail in a workflow step

Because `ai.image` returns the same envelope as every other verb, it drops straight into a workflow `run` step. Throw on `error` and the step's retry/backoff handles transient provider faults:

```ts
ai.step({
  name: "thumbnail",
  run: async (ctx) => {
    const { data, error } = await ai.image({
      model: openai.image({ name: "gpt-image-1" }),
      prompt: `product photo, white background: ${ctx.steps.extract.output.title}`,
      size: "1024x1024",
    });
    if (error) throw error;
    ctx.state.thumb = data.images[0];
  },
});
```

## Observability

The completed `ImageReport` routes to any registered `Observer` through the shared `observe` seam — pass `observe: true` (global), an `Observer` object (flow-local), or rely on observe-all. Cost and latency attribute to `report.model` for free, the same way agent runs do.

## Testing

`MockSDK({ imageResponses, imagePricing }).image({ name })` returns a deterministic image model — no HTTP. Script images, usage, and errors, then inspect `model.calls`.

```ts
import { MockSDK } from "@warlock.js/ai";

const mock = MockSDK({ imageResponses: [{}], imagePricing: { perImage: 0.04 } });
const { data, usage } = await ai.image({
  model: mock.image({ name: "mock-image" }),
  prompt: "x",
});
```

## Related

- [Generate speech](/v/v4/ai/modalities/generate-speech/) — the audio-output verb (`ai.speech`).
- [Transcribe audio](/v/v4/ai/modalities/transcribe-audio/) — the audio-input verb (`ai.transcribe`).
- [Run agent](/v/v4/ai/agents/run-agent/) — the chat/tool-calling verb, and image/vision **input**.
- [Handle errors](/v/v4/ai/reliability/handle-errors/) — the typed `AIError` taxonomy on `result.error`.
