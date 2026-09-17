# Changelog — @warlock.js/herald

All notable changes to `@warlock.js/herald` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.13.0 - 2026-09-17

### Changed

- Portable `typecheck` script: runs against this package's own `typescript` devDependency instead of relying on a hoisted binary from elsewhere in the workspace.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.7.0 - 2026-09-11

### Changed

- Internal type-safety hardening; no behaviour change.

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

- Documented: the README, CHANGELOG, and `herald-basics` skill now describe
  the already-shipped `package.json` `"warlock": { "environment": "server" }`
  marker — `@warlock.js/herald`'s entire runtime surface is server-only. The
  marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

## 5.1.0

No changes to `@warlock.js/herald`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/herald`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/herald`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **Poison-message DoS: an `EventConsumer.handle()` that reliably throws was nack+requeued forever**, with no retry cap and no dead-letter escape hatch — a single bad message could pin a consumer in a hot ack/nack loop indefinitely, starving every other message behind it (worse with low prefetch). `prepareConsumerSubscription`'s catch now calls the channel's bounded `ctx.retry()` instead of an unconditional `ctx.nack(true)`, so redelivery is capped and the message is dead-lettered (if configured) or dropped with a loud `log.error` once the cap is hit — never silently, and never forever
- **Fixed the retry counter never advancing on the automatic (non-explicit) nack path** (`RabbitMQChannel.subscribe`'s catch, used by any direct `channel.subscribe(handler, { retry, deadLetter })` caller whose handler throws instead of calling `ctx.retry()` itself). It read `x-retry-count` from the *original* message's headers and then plain-`nack(msg, false, true)`'d — which redelivers that same original message, so the header a developer's `retry.maxRetries`/`deadLetter` depended on never changed and the configured cap was silently never reached. Both the automatic path and the explicit `ctx.retry()` path now share one bounded-retry routine that republishes with an incremented header, so `maxRetries`/`deadLetter` are honored regardless of which path a handler takes
- **Broker credentials no longer leak into thrown/logged connection errors.** `username`/`password` are now URI-encoded when building the `amqp://` URL (a reserved character like `@`/`:`/`/` in a generated secret previously produced a malformed URL whose parser error echoed the raw credential back), and any error surfaced from `connect()` — including one that embeds a caller-supplied `uri` with credentials — has `user:pass@` redacted before it's re-thrown, so a connection failure can no longer put a plaintext broker password in front of `console.error`/structured logging/an error tracker

### Dependencies

- Bumped `@mongez/events` to `^2.2.7` (no breaking changes) and `@mongez/reinforcements` to `^4.0.1`. The reinforcements major makes `Random.string/nanoid/id/token/uuid` CSPRNG-backed (WebCrypto) and removes `Random.seed()` support — audited this package's source and tests for `Random.seed(` and for seeded/reproducible use of `Random.*`; none found, so no code changes were needed.

## 4.15.0 - 2026-08-16

### Fixed

- **The RabbitMQ driver's lazy `amqplib` loader was not idempotent under concurrent callers.** It cached the resolved module in a module-level binding but nothing guarded the load itself, so two loads could be in flight at the same time and the last one to settle won the binding. The eager, unawaited `loadAmqplibModule()` call at module scope was one of those callers by construction — it started a load nobody was waiting on, which then raced the awaited call from `connect()`. That eager call has been removed: `connect()` already awaits the loader, so it bought nothing but the race. The loader now memoizes the in-flight promise itself, so the first caller starts the `import()` and every later caller awaits that same one
- **No user-visible misbehaviour is known in production** — both racing paths resolve the same real `amqplib`, so whichever won, callers got the module they expected. The observable damage was in test isolation: when a test was aborted mid-`await import(...)`, the racing loads could leave the binding holding the real `amqplib` while the test file's `vi.mock("amqplib")` was still active, so every later test in that file silently bypassed the mock and opened a real socket. Proven by instrumentation — the driver held a live `ChannelModel` on `::1:5672` while `import("amqplib")` inside the same test still returned the mock, which is how a green test could be green for the wrong reason
- **Verified by a timeout sweep, not by a passing suite.** The full suite passed both before and after (13 files / 137 tests), because the fault only surfaces when the first test is starved of time. Running `tests/connect-to-broker.test.ts` at `--testTimeout=3000` and `4000` previously timed out the first test *and* took `wraps a connection failure with the driver name` down with it, failing in ~50 ms with `promise resolved "Broker{…}" instead of rejecting` — the mock was gone. With the loader fixed, that test passes at every timeout even while the first test still times out: starving one test can no longer poison the next
- **The first test also paid a cold-transform cost inside its own timed body**, since `connectToBroker` dynamically imports the driver, which pulls in `@warlock.js/seal` and `@warlock.js/logger` as raw TS source. That work moved to a `beforeAll` warm-up. This is a test-timing change only and carries none of the correctness weight above — the loader fix stands on its own without it

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.2.11

### Changed

- Bumped `@mongez/reinforcements` to 3.3.0

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
