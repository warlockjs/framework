---
title: "Generate speech"
description: ai.speech is the text-to-speech output verb — text in, synthesized audio out, in the same never-throws { data, error, usage, report } envelope every AI verb returns.
sidebar:
  order: 12
  label: "Generate speech"
---

`ai.speech()` is the audio-output counterpart to [`ai.image()`](./generate-images). Text-in / audio-out, wrapped in the **same** uniform result contract every AI verb returns — so a synthesized voicemail slots into your cost dashboards and observability traces exactly like an agent run.

This is audio **output** (TTS). For audio **input** — transcribing a WhatsApp voice note or a meeting recording — see [Transcribe audio](./transcribe-audio).

## The core API

Build a speech model from the adapter's `speech()` factory, then run the verb. It never throws — provider faults land on `result.error`.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import fs from "node:fs/promises";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.speech({ name: "tts-1", voice: "alloy" }); // SpeechModelContract

const { data, error, usage, report } = await ai.speech({
  model,
  text: "Your order has shipped.",
});

if (error) {
  console.warn(error.code); // typed AIError (auth / rate-limit / content-filter / …)
} else {
  const { base64, mediaType } = data.audio; // GeneratedAudio
  await fs.writeFile("ship.mp3", Buffer.from(base64, "base64"));
}
```

`SpeechModelContract` is a peer primitive produced by the adapter's optional `speech?()` factory — the same shape as `EmbedderContract` and `ImageModelContract`. An adapter without a TTS API simply doesn't define `speech()`, so calling it there is a **compile-time** error, not a silent runtime failure.

:::tip
A non-TTS model id (`openai.speech({ name: "gpt-4o" })`) throws `InvalidRequestError` **at construction** — you fail fast, before any request goes out.
:::

## The result envelope

Every AI verb returns the same discriminated envelope. For speech:

```ts
type SpeechResult = {
  type: "speech";
  data?: { audio: GeneratedAudio }; // undefined on failure
  error?: AIError;                  // undefined on success — NEVER thrown
  usage: Usage;                     // tokens (gpt-4o-mini-tts) + cost when priced
  report: SpeechReport;             // type:"speech", model, characters, lineage
};

type GeneratedAudio = {
  type: "base64";
  base64: string;    // base64-encoded audio bytes
  mediaType: string; // IANA type, e.g. "audio/mpeg", "audio/wav"
};
```

`GeneratedAudio` is a discriminated union with a single `base64` variant today — the union leaves room for a future hosted-`url` variant without a breaking change, so always branch on `audio.type` rather than assuming `base64`.

## Generation options

The options are provider-neutral. Each adapter maps the ones its API supports and forwards `options` verbatim.

```ts
await ai.speech({
  model,
  text: "Welcome aboard. Let's get you set up.",
  voice: "verse",              // voice id/name; overrides the model's default
  format: "wav",               // "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"
  speed: 1.25,                 // playback multiplier (OpenAI 0.25–4.0)
  instructions: "calm, warm",  // tone/delivery steering (gpt-4o-mini-tts only)
  signal,                      // AbortSignal
  observe: collector,          // route the report to an Observer
  sessionId: "onboarding-42",  // group into a session for flat cost/trace queries
  options: { /* provider passthrough */ },
});
```

On OpenAI the container defaults to `mp3` (→ `audio/mpeg`); `speed` and `instructions` are only sent when set, and the default voice is `alloy` when neither the call nor the model config supplies one.

## OpenAI — tts-1 (per-character) + gpt-4o-mini-tts (per-token)

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// tts-1 / tts-1-hd — billed per INPUT CHARACTER.
const classic = openai.speech({
  name: "tts-1",
  voice: "alloy",
  pricing: { perMillionCharacters: 15 },
});

// gpt-4o-mini-tts — billed per TOKEN like a chat model; supports `instructions`.
const steered = openai.speech({
  name: "gpt-4o-mini-tts",
  pricing: { input: 0.6, output: 12 },
});

const { data } = await ai.speech({
  model: steered,
  text: "Read this warmly.",
  instructions: "gentle",
});
```

## Cost-truth — one rollup, two metering models

`ai.speech` fills `usage.cost` (a USD breakdown) so TTS spend folds into the **same** `Usage.cost` rollup as text — there's no second accounting path:

- **Per-character** (`tts-1` / `tts-1-hd`): `{ perMillionCharacters }` × `report.characters` → `cost.input`. The Speech API reports no token usage, so `usage` tokens stay `{ 0, 0, 0 }` and spend is priced entirely from the input character count.
- **Token-metered** (`gpt-4o-mini-tts`): `{ input, output }` USD-per-1M-tokens against the returned token usage.

Per-character wins when both are set. An unpriced model leaves `usage.cost` **`undefined`** — an honest "cost unknown", never a false zero. A pre-priced adapter response is honored, not overwritten.

## Real-world — order-confirmation voice line in a workflow step

Because `ai.speech` returns the same envelope as every other verb, it drops straight into a workflow `run` step. Throw on `error` and the step's retry/backoff handles transient provider faults:

```ts
ai.step({
  name: "voiceLine",
  run: async (ctx) => {
    const { data, error } = await ai.speech({
      model: openai.speech({ name: "tts-1", voice: "alloy" }),
      text: `Order ${ctx.steps.order.output.id} confirmed. Thank you!`,
      format: "mp3",
    });
    if (error) throw error;
    ctx.state.audio = data.audio; // { type:"base64", base64, mediaType:"audio/mpeg" }
  },
});
```

## Observability

The completed `SpeechReport` (with `report.characters` and cost/latency attributed to `report.model`) routes to any registered `Observer` through the shared `observe` seam — pass `observe: true` (global), an `Observer` object (flow-local), or rely on observe-all. Provider faults surface as typed `AIError`s on `result.error`.

## Testing

`MockSpeechModel(name, responses, pricing?)` is a deterministic `SpeechModelContract` double — no HTTP. Script audio, usage, and errors, then inspect `model.calls`. `MockSDK({ speechResponses, speechPricing }).speech({ name })` wires the same double behind a full adapter.

```ts
import { MockSpeechModel, speech } from "@warlock.js/ai";

const model = new MockSpeechModel("tts-1", [{}], { perMillionCharacters: 15 });
const { data, usage } = await speech({ model, text: "abcdefghij" }); // 10 chars
// data.audio  → { type:"base64", base64:"AAAA", mediaType:"audio/mpeg" }
// usage.cost.input → (10 * 15) / 1_000_000
// model.calls[0] records { text, options } for assertions
```

Scripting `[{ error: new ProviderRateLimitError("slow down") }]` drives the never-throws path — `result.error` is the typed error and `result.data` is `undefined`.

## Related

- [Transcribe audio](./transcribe-audio) — the inverse verb (`ai.transcribe`), audio → text.
- [Generate images](./generate-images) — the sibling image-output verb (`ai.image`).
- [Run agent](./run-agent) — the chat/tool-calling verb.
- [Handle errors](../digging-deeper/handle-errors) — the typed `AIError` taxonomy on `result.error`.
