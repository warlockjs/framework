# Changelog — @warlock.js/herald

All notable changes to `@warlock.js/herald` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.15.0

### Fixed

- **The RabbitMQ driver's lazy `amqplib` loader was not idempotent under concurrent callers.** It cached the resolved module in a module-level binding but nothing guarded the load itself, so two loads could be in flight at the same time and the last one to settle won the binding. The eager, unawaited `loadAmqplibModule()` call at module scope was one of those callers by construction — it started a load nobody was waiting on, which then raced the awaited call from `connect()`. That eager call has been removed: `connect()` already awaits the loader, so it bought nothing but the race. The loader now memoizes the in-flight promise itself, so the first caller starts the `import()` and every later caller awaits that same one
- **No user-visible misbehaviour is known in production** — both racing paths resolve the same real `amqplib`, so whichever won, callers got the module they expected. The observable damage was in test isolation: when a test was aborted mid-`await import(...)`, the racing loads could leave the binding holding the real `amqplib` while the test file's `vi.mock("amqplib")` was still active, so every later test in that file silently bypassed the mock and opened a real socket. Proven by instrumentation — the driver held a live `ChannelModel` on `::1:5672` while `import("amqplib")` inside the same test still returned the mock, which is how a green test could be green for the wrong reason
- **Verified by a timeout sweep, not by a passing suite.** The full suite passed both before and after (13 files / 137 tests), because the fault only surfaces when the first test is starved of time. Running `tests/connect-to-broker.test.ts` at `--testTimeout=3000` and `4000` previously timed out the first test *and* took `wraps a connection failure with the driver name` down with it, failing in ~50 ms with `promise resolved "Broker{…}" instead of rejecting` — the mock was gone. With the loader fixed, that test passes at every timeout even while the first test still times out: starving one test can no longer poison the next
- **The first test also paid a cold-transform cost inside its own timed body**, since `connectToBroker` dynamically imports the driver, which pulls in `@warlock.js/seal` and `@warlock.js/logger` as raw TS source. That work moved to a `beforeAll` warm-up. This is a test-timing change only and carries none of the correctness weight above — the loader fix stands on its own without it

### Dependencies

- Bumped `@mongez/events` to `^2.2.7` (no breaking changes) and `@mongez/reinforcements` to `^4.0.1`. The reinforcements major makes `Random.string/nanoid/id/token/uuid` CSPRNG-backed (WebCrypto) and removes `Random.seed()` support — audited this package's source and tests for `Random.seed(` and for seeded/reproducible use of `Random.*`; none found, so no code changes were needed.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.2.11

### Changed

- Bumped `@mongez/reinforcements` to 3.3.0

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
