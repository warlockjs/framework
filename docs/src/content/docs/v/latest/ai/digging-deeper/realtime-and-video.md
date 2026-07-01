---
title: "Realtime & video"
description: The @warlock.js/ai-live add-on — ai.video (text-to-video behind the uniform never-throws envelope with per-second cost-truth) and ai.realtime (a duplex voice session over a pluggable transport that closes to a report).
sidebar:
  order: 18
  label: "Realtime & video"
---

`@warlock.js/ai` ships the synchronous modality verbs — `ai.agent`, `ai.image`, `ai.speech`, `ai.transcribe`. The two heaviest output modalities live in a separate package, `@warlock.js/ai-live`, because they need demand-gated machinery the core shouldn't carry for everyone: a **long-running job** (video) and a **persistent network session** (realtime voice). Keeping them out-of-core keeps the base install dependency-light.

Both mount onto the same `ai.*` facade by a **side-effect import** — you import the package for its effect, then keep using `ai` exactly as before:

```ts
import "@warlock.js/ai-live"; // lights up ai.video + ai.realtime on the shared Ai facade
import { ai } from "@warlock.js/ai";
```

The mount mirrors how `@warlock.js/ai-tools` lights up `ai.mcp` and `@warlock.js/ai-workspace` lights up `ai.workspace`: a `declare module "@warlock.js/ai"` interface-merge plus `ai.video = video; ai.realtime = realtime` at load time.

:::caution
Forget the side-effect import and `ai.video` / `ai.realtime` are a compile-time `undefined` — TypeScript flags them, so it's a build error, not a silent runtime miss.
:::

## `ai.video` — text-to-video, uniform envelope

Prompt in, one video out. The adapter hides the provider's async **submit→poll** lifecycle and resolves only when the clip is ready, so the verb returns the framework's uniform **never-throws** `{ data, error, usage, report }` — the exact shape `ai.image` returns. Video spend and traces therefore fold into the same dashboards as every other modality.

```ts
import { ai } from "@warlock.js/ai";

const { data, error, usage, report } = await ai.video({
  model: sora.video({ name: "sora-2", pricing: { perSecond: 0.1 } }), // VideoModelContract
  prompt: "a timelapse of a city skyline at dusk, cinematic",
  durationSeconds: 8,
  aspectRatio: "16:9",
});

if (error) {
  console.warn(error.code); // typed AIError — NEVER thrown
} else {
  const clip = data.video; // GeneratedVideo (discriminated)
  if (clip.type === "url") download(clip.url);
  else save(Buffer.from(clip.base64, "base64"), clip.mediaType);
}
```

The returned clip is a discriminated `GeneratedVideo` — you branch on `clip.type` to know whether the provider handed back a hosted URL or an inline base64 payload:

```ts
type GeneratedVideo =
  | { type: "url"; url: string; mediaType?: string }
  | { type: "base64"; base64: string; mediaType: string };
```

### Params

The model is the only field required beyond the prompt; everything else is a provider-neutral hint:

```ts
await ai.video({
  model, // VideoModelContract from an adapter's video({ name })
  prompt: "...",
  durationSeconds: 8, // requested clip length
  aspectRatio: "9:16",
  resolution: "1080p", // hint
  negativePrompt: "blurry, watermark",
  signal, // AbortSignal → status "cancelled"
  observe: collector, // route the report to an Observer (panoptic), like agents
  sessionId: "campaign-42",
  name: "hero-clip", // report node name (defaults to "video")
  options: { seed: 7 }, // provider-specific escape hatch, forwarded verbatim
});
```

`VideoModelContract` is the moving-image sibling of `ImageModelContract` — `{ name, provider, pricing?, generate(prompt, options) }` — produced by an adapter's `video()` factory. An adapter with no video API simply doesn't define `video()`.

## Video cost-truth — per-second first

`VideoModelPricing` carries `{ perSecond?, input?, output? }`. Per-second wins when it's set, because video is metered by clip length rather than tokens:

```ts
// usage.cost = { input: 0, output: durationSeconds × perSecond }
```

The math runs on the **final** `durationSeconds` the provider reports back (not just the requested one), and that number also lands on `report.durationSeconds`. A token-metered model falls back to the standard token cost. With no usable pricing, `usage.cost` stays `undefined` — an honest "cost unknown", never a false zero — and a pre-priced adapter response is honored rather than overwritten.

## `ai.realtime` — a duplex voice session

Unlike every other `ai.*` verb, `ai.realtime()` returns a **stateful, long-lived session**, not a one-shot result — its closest sibling is `ai.orchestrator`. You open it over a pluggable **`RealtimeTransport`** (the low-level connection to the provider's realtime endpoint), push microphone audio or text turns in, consume an async **event stream** out, and `close()` to end it and receive a `RealtimeReport` for the cost/observability surfaces.

```ts
import { ai } from "@warlock.js/ai";

const session = await ai.realtime({
  transport: openAiRealtime({ apiKey }), // RealtimeTransport (own adapter)
  model: "gpt-realtime",
  voice: "alloy",
  instructions: "You are a friendly phone receptionist.",
  sessionId: "call-8891",
});

session.sendAudio(micChunkBase64, "audio/pcm"); // push mic audio upstream
session.sendText("Please hold for one moment."); // or a text turn

for await (const event of session.events()) {
  // duplex output
  switch (event.type) {
    case "audio":
      speaker.write(event.base64);
      break;
    case "transcript":
      if (event.final) log(event.role, event.text);
      break;
    case "tool-call":
      await handleTool(event.name, event.input);
      break;
    case "error":
      console.warn(event.error.code);
      break;
    case "done":
      break;
  }
}

const report = await session.close(); // RealtimeReport — idempotent
```

### Session contract & event union

```ts
interface RealtimeSession {
  sendAudio(base64: string, mediaType: string): void;
  sendText(text: string): void;
  events(): AsyncIterable<RealtimeEvent>;
  close(): Promise<RealtimeReport>; // idempotent — second close() returns the first report
}

type RealtimeEvent =
  | { type: "audio"; base64: string; mediaType: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "error"; error: AIError } // typed, non-fatal
  | { type: "done" }; // server ended the session
```

The `error` event is typed and **non-fatal** — the stream keeps going, so you log or recover and let the session run on. The transport seam is what lets `ai-live` ship the session surface without hard-wiring `ws` (it's an optional peer): a concrete transport implements just `RealtimeTransport.connect(config)`, returning a connection with the same `sendAudio` / `sendText` / `events()` / `close()` verbs.

## A live phone receptionist over a channel

Wire the session's two halves to a phone channel — pump the caller's audio in, pump the model's audio back out, and record the run on close:

```ts
import "@warlock.js/ai-live";
import { ai } from "@warlock.js/ai";

async function handleCall(caller: PhoneChannel, transport: RealtimeTransport) {
  const session = await ai.realtime({
    transport,
    model: "gpt-realtime",
    voice: "alloy",
    instructions: "Greet the caller and route them to the right department.",
    sessionId: caller.id,
  });

  // Pump caller audio → session (fire-and-forget).
  caller.onAudio((chunk) => session.sendAudio(chunk, "audio/pcm"));

  // Pump session output → caller, until the model signals done.
  for await (const event of session.events()) {
    if (event.type === "audio") caller.playAudio(event.base64);
    if (event.type === "done") break;
  }

  const report = await session.close();
  metrics.record({ runId: report.runId, seconds: report.duration / 1000 });
}
```

## Testing — mocks, no HTTP, no sockets

`@warlock.js/ai-live` exports deterministic doubles so both verbs test offline — no network, no WebSocket.

```ts
import { ai } from "@warlock.js/ai";
import { MockVideoModel, MockRealtimeTransport } from "@warlock.js/ai-live";

// Video — script the returned clip / usage / duration; assert cost math + recorded calls.
const model = new MockVideoModel("mock-video", [{ durationSeconds: 8 }], { perSecond: 0.1 });
const { data, usage } = await ai.video({ model, prompt: "x", durationSeconds: 8 });
// data.video      → { type: "url", url: "https://mock/video.mp4", ... }
// usage.cost.output === 0.8   (8 × 0.1)
// model.calls[0]  → { prompt: "x", options: { durationSeconds: 8, ... } }

// Realtime — script the outbound event stream; assert what the session sent.
const transport = new MockRealtimeTransport([
  { type: "transcript", role: "assistant", text: "Hi!", final: true },
  { type: "done" },
]);
const session = await ai.realtime({ transport, model: "mock-realtime" });
session.sendText("hello");
for await (const e of session.events()) {
  /* ... */
}
const report = await session.close();
// transport.lastConnection.sentText → ["hello"]
// transport.connectConfigs[0]       → { model: "mock-realtime", ... }
// report.status === "completed"
```

Feed `MockVideoModel` an `{ error }` response and `ai.video` lands it on `result.error` (still never throws), setting `report.status` to `"failed"` — or `"cancelled"` when the `signal` aborted.

## Status — contracts now, transports next

:::note
`4.6.0` introduces the package: the `VideoModelContract` / `RealtimeSession` contracts, the `ai.video()` verb (uniform envelope + per-second cost-truth, tested against `MockVideoModel`), and the `ai.realtime()` session primitive over a pluggable transport (tested against `MockRealtimeTransport`). The first **concrete provider transports** — an OpenAI Realtime **WebSocket** for `ai.realtime`, and **Sora / Veo** video adapters for `ai.video` — are the next implementation step (v4.7). The seams are already defined, so they drop in without changing the verb surface.
:::

## Related

- [Generate images](../the-basics/generate-images) — still-image output (`ai.image`), the synchronous sibling `ai.video` mirrors.
- [Run orchestrator](./run-orchestrator) — the other session-shaped primitive `ai.realtime` resembles.
- [Log AI calls](./log-ai-calls) — the `observe` seam both verbs route their reports through.
- [Handle errors](./handle-errors) — how the typed `AIError` on `result.error` and the realtime `error` event surface.
