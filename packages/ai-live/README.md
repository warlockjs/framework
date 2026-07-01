# `@warlock.js/ai-live`

**Live & generative rich-media for `@warlock.js/ai`** — the two heaviest output
modalities, kept in their own package so the core stays dependency-light.

`@warlock.js/ai` ships the synchronous modality verbs (`ai.agent`, `ai.image`,
`ai.speech`, `ai.transcribe`). `ai-live` adds the two that need heavyweight,
demand-gated machinery — a persistent network session and a long-running job —
mounted onto the same `ai.*` facade by importing the package:

```ts
import "@warlock.js/ai-live"; // side-effect: lights up ai.realtime + ai.video
```

## What it gives you

### `ai.realtime(options)` — duplex realtime voice sessions
A **stateful, bidirectional voice session** (OpenAI Realtime-class): stream
microphone audio in, stream synthesized audio + transcripts + tool-calls out,
with barge-in. Unlike every other `ai.*` verb (one-shot request → result), this
is a **session primitive** — its closest sibling is `ai.orchestrator`. You open
a session over a pluggable **transport** (a WebSocket to the provider's realtime
endpoint), push audio, and consume an async event stream until you `close()` it
(which yields a final report for cost/observability).

```ts
const session = await ai.realtime({
  transport: openAiRealtime({ apiKey }),   // provider transport (own adapter)
  model: "gpt-realtime",
  voice: "alloy",
  instructions: "You are a friendly phone receptionist.",
});

session.sendAudio(micChunk, "audio/pcm");
for await (const event of session.events()) {
  if (event.type === "audio") speaker.write(event.base64);
  if (event.type === "transcript" && event.final) log(event.role, event.text);
}
const report = await session.close();
```

### `ai.video(params)` — text-to-video generation
Prompt → video (Sora / Veo / Kling-class). Generation is **async** (submit →
poll), but the adapter hides the polling, so the verb returns the same uniform
never-throws `{ data, error, usage, report }` envelope as `ai.image`, with
per-second cost-truth folded into `Usage.cost`.

```ts
const { data, error, usage } = await ai.video({
  model: sora.video({ name: "sora-2", pricing: { perSecond: 0.1 } }),
  prompt: "a timelapse of a city skyline at dusk, cinematic",
  durationSeconds: 8,
  aspectRatio: "16:9",
});
if (!error) download(data.video); // { type: "url" | "base64", ... }
```

## Why a separate package

- **Heavy / optional deps.** Realtime needs a WebSocket transport (`ws` is an
  optional peer); video pulls long-poll + large-payload handling. Most apps
  using text/image/speech shouldn't carry that weight.
- **Different shape.** `ai.realtime` is a *session*, not a request; `ai.video`
  is a *long job*. Isolating them keeps the core verbs simple and synchronous.
- **Same contracts.** Both still produce a `BaseReport` (`type: "realtime"` /
  `"video"`) and route through the shared `observe` seam, so panoptic and the
  cost tree pick them up for free.

## Status

`4.6.0` introduces the package with the **`VideoModelContract` / `RealtimeSession`
contracts**, the `ai.video()` verb (uniform envelope + cost-truth, tested against
a mock), and the `ai.realtime()` session primitive over a **pluggable transport**
(tested against a mock transport). The first concrete provider transports
(OpenAI Realtime WebSocket; Sora / Veo video adapters) are the next implementation
step — the seams are defined so they drop in without changing the verb surface.
