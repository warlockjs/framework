# Warlock.js test runtime: per-file bootstrap dominates Vitest time

Report date: **2026-10-21**. Observed on a production consumer application (Forma AI) with
`@warlock.js/core` **5.33.0**, Vitest **4.1.11**, Node **22.15.0**, MongoDB through
`mongodb-memory-server` (single-node replica set started once in global setup), Linux host with
48 logical CPUs. The suite ran inside a cgroup wrapper capped at 12 CPUs and 16 GB.

Report IDs (`TR-xx`) are local references, not upstream issue numbers.

## Summary

A full server test run takes about **75 minutes**. Most of that is not testing:

| Vitest phase (full suite, 1,335 files, 6,780 tests) | Time | Share |
| --------------------------------------------------- | ---: | ----: |
| setup (`setupFiles` → `setupTest()` per file)       | 3,532.79 s | **79%** |
| tests                                               | 617.54 s | 14% |
| import                                              | 112.48 s | 3% |
| transform                                           | 24.18 s | <1% |
| **Duration (wall clock)**                           | **4,465.55 s** | |

Source: the release gate log of web release 1.3.2 (Vitest's own summary line:
`Duration 4465.55s (transform 24.18s, setup 3532.79s, import 112.48s, tests 617.54s, environment 139ms)`).

On average each test file pays about **2.6 s of framework setup** before its first test, while its
tests take about 0.46 s. This multiplies release lead time: an application with no slow tests still
waits over an hour per release gate, so teams start skipping the full suite. The project owner
skipped it for the next release for exactly this reason.

## What runs per test file today

The generated `src/test-setup.ts` is a Vitest `setupFiles` entry that calls `setupTest()` and
registers `afterAll(teardownTest)`. Vitest runs `setupFiles` before **every test file** and rebuilds
the module registry each time. `@warlock.js/core/tests` (`esm/tests/vitest-setup.mjs`) documents this
("Runs once per TEST FILE, not once per worker").

Each `setupTest()` call performs, in order (`runTestRuntimeStartup`):

1. `Application.setEnvironment("test")`
2. `warlockConfigManager.load()`
3. `bootstrap()`: env, app and prestart hooks
4. `filesOrchestrator.init()`: initialises the tsconfig and package.json managers, ensures the
   `.warlock` directory, and **registers the dev-server ESM loader hook** (`registerLoader`) with
   its transpile settings
5. `loadConfigFiles(true)`: imports every `src/config/*.ts`
6. connector start-up (all but `http` by default: database, cache, logger, storage, and so on)
7. `installTestFakes()`

`teardownTest()` then shuts every connector down. With 1,335 files, that is 1,335 full application
start/stop cycles, each including a fresh database connection pool.

The framework already anticipates this. The `test-service` skill
(`node_modules/@warlock.js/core/skills/test-service/SKILL.md`) says:

> A worker-scoped lifetime is possible and is deliberately not shipped yet. […] It gets taken when
> the real cost is measured and the integration is chosen, not inherited.

The numbers above are that measurement from a real application.

## Requested changes

### TR-01 (high): opt-in worker-scoped test runtime

**Need:** start the framework once per Vitest worker and reuse it for every file that worker runs,
instead of once per file.

**Proposal:** a configuration switch, for example `tests.lifetime: "file" | "worker"`, defaulting to
`"file"` until proven. In `"worker"` mode:

- the first `setupTest()` in a worker boots the framework; later calls in the same worker reuse it;
- each file still gets a clean state boundary: fakes reset, clock/ids reset, and an optional
  per-file database hook (for example truncate or drop the collections touched, or a
  `tests.resetBetweenFiles` callback);
- teardown runs once when the worker exits. The skill's blockers (thread socket reclamation under
  `pool: "threads"`, worker reuse in watch mode) can be avoided by supporting `pool: "forks"` and
  `vitest run` first and refusing or falling back to `"file"` elsewhere, with a clear message.

**Acceptance criteria:**

- a suite of N files under `"worker"` mode performs at most `maxWorkers` bootstraps (verifiable by
  a counter or debug log);
- tests keep passing for files that set up and depend on their own fixtures, provided the per-file
  reset hook is used;
- documented in `test-service` with the isolation trade-offs;
- measured before/after numbers on a reference application in the changelog.

**Expected effect for this application:** setup time falls from ~3,533 s toward
`maxWorkers × 2.6 s` plus per-file reset cost, so most of the 59 minutes of setup disappears.

### TR-02 (high): cheap bootstrap for pure unit tests

**Need:** many `*.spec.ts` files are unit tests with mocked collaborators. They need module
resolution and perhaps config, not connectors, loader hooks or prestart hooks. Today
`setupTest({ connectors: false })` still runs steps 1–5 and 7 above.

**Proposal:** one of:

- a documented "unit" mode (for example `setupTest({ mode: "unit" })`) that loads config once and
  skips bootstrap hooks and `filesOrchestrator.init()` when the test runs inside Vitest's own module
  graph (`importModule` is provided);
- or a recommended Vitest **projects** layout in the scaffold and skill: a `unit` project without the
  Warlock setup file, and an `integration` project with it, using a file convention such as
  `*.spec.ts` = unit, `*.test.ts` and `tests/**` = integration.

**Acceptance criteria:** a pure service spec with mocked repositories runs with no database
connection and no loader-hook registration, and `warlock add test` / the scaffold generate the split
configuration.

### TR-03 (medium, needs verification): loader-hook registration in every test file

`filesOrchestrator.init()` guards with `this.isInitialized`, but that flag lives on a module instance
that Vitest rebuilds for each file. If each rebuild registers the ESM loader hook again through
`module.register`, Node may accumulate hook registrations (and their hooks thread work) for the life
of the worker, which would make later files slower than earlier ones.

**Ask:** confirm whether `registerLoader` runs once per worker or once per file under Vitest. If it
runs per file, register once per process (for example a `globalThis` symbol guard, like the
lifecycle registry already uses) or skip it entirely when Vitest owns module loading.

Not verified in this report: no per-step profiling was run (the host's operating rules forbid
profiling without explicit approval).

### TR-04 (medium): setup timing instrumentation

**Need:** applications cannot tell which of the seven steps costs the most.

**Proposal:** `tests.profileSetup: true` (or `WARLOCK_TEST_PROFILE=1`) prints one line per file with
the milliseconds spent in each step and in teardown, plus a run summary. That turns TR-01/TR-02
tuning into data instead of guesses, and gives maintainers comparable numbers from users.

### TR-05 (low): document parallelism and worker count for CPU-capped CI

**Update 2026-10-21: the serial run was the application's choice, not the framework's.** The consumer
application's release gate runs `vitest run --maxWorkers=2 --no-file-parallelism`, which explains why
the phase totals matched the wall-clock time. A developer run of the same suite without those flags
took 1,932 s instead of 4,466 s. This finding no longer suspects the Warlock lifecycle of serialising
files. TR-01 and TR-02 stand: per-file setup is still the dominant CPU cost however it is scheduled.

Vitest sizes its pool from `os.availableParallelism()`, which reports **48** on this host even when
the process is confined to 12 CPUs by a cgroup quota.

**Ask:** document whether Warlock test suites are safe to run with file parallelism (each worker
needs its own database or isolated fixtures; the shared HTTP test server from global setup is
reused), and recommend a `maxWorkers` for CPU-capped CI, or have the scaffolded Vitest config derive
it from the cgroup quota when present.

### TR-06 (low): document `warlock test --changed` for release gates

`warlock test --changed [--since main]` exists (documented inside `test-service`) but is not
mentioned in the release or CI guidance. A short "release gate" recipe would help teams: changed and
affected tests plus integration tests on every release, and the full suite nightly.

## Interim measures in the consumer application

These need no framework change and are planned in the application:

1. Split the Vitest configuration into a `unit` project (no Warlock setup file) and an
   `integration` project (with it).
2. Gate releases on affected tests (`warlock test --changed --since <last release>`) plus
   integration tests, with the full suite on a nightly schedule.

## Not verified

- No fresh minimal reproduction on the latest `@warlock.js/core` release; the observations come from
  5.33.0. The setup steps listed above were read from the installed 5.33.0 package source.
- No per-step timing (see TR-04). The 2.6 s average is total setup time divided by file count.
- TR-03 is a hypothesis from source reading, not confirmed behaviour. TR-05 was traced to the application's own `--no-file-parallelism` gate flag.
