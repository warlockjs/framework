# Changelog — @warlock.js/ai-live

All notable changes to `@warlock.js/ai-live` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Added

- **First release** — the live & generative rich-media add-on for `@warlock.js/ai`, kept in its own package so core text/image/speech stay dependency-light. A side-effect import (`import "@warlock.js/ai-live"`) mounts `ai.video` + `ai.realtime` onto the shared `Ai` facade.
- **`ai.video(params)`** — text-to-video (Sora / Veo / Kling-class); the provider's async submit→poll job hidden behind the uniform never-throws `{ data, error, usage, report }` envelope, with per-second cost-truth folded into `Usage.cost` and a `type: "video"` report routed to observers.
- **`ai.realtime(options)`** — a stateful duplex voice session over a pluggable `RealtimeTransport`: `sendAudio` / `sendText` / `events()` out, `close()` → `RealtimeReport` for the cost/observability surfaces.
- **Contracts** — `VideoModelContract`, `GeneratedVideo`, `VideoModelPricing`, `VideoOptions`; `RealtimeSession`, `RealtimeTransport`, `RealtimeConnection`, `RealtimeEvent`, `RealtimeReport`, `RealtimeOptions`.
- **Mocks** — `MockVideoModel` + `MockRealtimeTransport` for deterministic, HTTP- and socket-free tests (scripted responses / event streams, recorded calls).
