# Changelog — @warlock.js/ai-live

All notable changes to `@warlock.js/ai-live` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

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
