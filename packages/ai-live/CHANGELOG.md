# Changelog — @warlock.js/ai-live

All notable changes to `@warlock.js/ai-live` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.1.0

No changes to `@warlock.js/ai-live`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-live`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-live`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Added

- **First release** — the live & generative rich-media add-on for `@warlock.js/ai`, kept in its own package so core text/image/speech stay dependency-light. A side-effect import (`import "@warlock.js/ai-live"`) mounts `ai.video` + `ai.realtime` onto the shared `Ai` facade.
- **`ai.video(params)`** — text-to-video (Sora / Veo / Kling-class); the provider's async submit→poll job hidden behind the uniform never-throws `{ data, error, usage, report }` envelope, with per-second cost-truth folded into `Usage.cost` and a `type: "video"` report routed to observers.
- **`ai.realtime(options)`** — a stateful duplex voice session over a pluggable `RealtimeTransport`: `sendAudio` / `sendText` / `events()` out, `close()` → `RealtimeReport` for the cost/observability surfaces.
- **Contracts** — `VideoModelContract`, `GeneratedVideo`, `VideoModelPricing`, `VideoOptions`; `RealtimeSession`, `RealtimeTransport`, `RealtimeConnection`, `RealtimeEvent`, `RealtimeReport`, `RealtimeOptions`.
- **Mocks** — `MockVideoModel` + `MockRealtimeTransport` for deterministic, HTTP- and socket-free tests (scripted responses / event streams, recorded calls).
