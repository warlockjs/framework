# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

> ⚠ **Versioning: `@warlock.js/*` does not follow SemVer strictly — breaking changes may ship in a minor.** This is a deliberate decision, not an oversight: the framework is pre-adoption and the cost of a major per behaviour fix currently outweighs the benefit. **Pin an exact version or a tilde range (`~4.13.0`) if you need to opt into changes rather than receive them.** Every breaking change is marked **BREAKING** in its entry and summarised in an *Upgrading* section at the top of the release. **This policy will change once the framework has consumers beyond its author.**

## Unreleased

### Added

- **Connectors can contribute to `warlock build` through an optional static
  `build` object.** Configured connectors may define ordered, awaited
  `generate(context)` and `emit(context)` hooks without being booted or started.
  `generate` can add generated entry imports and a narrow esbuild patch; `emit`
  can produce non-esbuild artifacts after the server bundle. Unknown contribution
  keys, duplicate/reserved connector names, generated unresolved imports, and hook
  failures stop the build instead of producing a partial artifact.
- **`warlock routes:diff`** — compares the live dev-server page-route surface against
  the last successful `warlock build`'s snapshot (`page-routes.manifest.json` in the
  build `outdir`). Boots diagnostically (same fail-loud boot as `warlock routes` /
  `warlock doctor` — no connectors started), then reports `changed` / `removed` /
  `added` page routes and exits non-zero on drift; exits `0` with "Page routes match"
  when the two agree. Refuses to run (with an instruction to run `warlock build`
  first) when no snapshot exists yet, or when an existing one is malformed. A route
  whose `path`/`name` moved but whose `source` file didn't is reported as one
  `changed` line instead of a `removed` + `added` pair.

### Changed

- **The HTTP connector now preflights its port before binding.** `warlock dev` and
  `warlock start` both go through `HttpConnector.start()`, which now calls
  `assertPortIsAvailable(port, host)` immediately before `listen()`. A collision now
  surfaces as `Port <port> is already in use on <host>. Stop the dev server (or
  whatever else is listening on port <port>) and run again...` instead of a raw
  `EADDRINUSE` thrown from inside Fastify. The test server (`startHttpTestServer`)
  already preflighted its port before this release; this brings `dev`/`start` to the
  same behavior.
- **`startHttpTestServer()` now runs `Application.runStartupValidators()`** — the
  same slot `warlock dev` and the generated production `app.ts` already ran it in —
  after application modules load and before the late-phase connectors (http, socket)
  bind. A validator registered via `Application.onValidateBoot(...)` that rejects now
  aborts the test server's boot exactly as it aborts `dev`/`start`, instead of only
  being enforced outside of tests.
- **`warlock add web` scaffolds a real, validated API endpoint**, not just a static
  page. It now also writes `src/app/contact/routes.ts` and
  `src/app/contact/controllers/contact.controller.ts` (a `POST /api/contact` route
  validated with `@warlock.js/seal`), and `src/web/home.page.tsx` ships an
  interactive, localized (en/ar) contact form wired to that route via `@mongez/http`
  + `@mongez/react-form` + `@mongez/react-localization`. The `web` feature now also
  installs those three packages as dependencies.

### Fixed

- **`startHttpTestServer()` fails loudly instead of silently skipping the preflight**
  when `http.port` doesn't round-trip through `Number()` (e.g. `HTTP_PORT=03999`,
  `+3999`, `1e3`, or a value with stray whitespace) — previously it returned early
  and let the connector reach `listen({ port })` with the unvalidated value and no
  published port for test workers to resolve.
- **A race in the mail SES driver** where `getSesMailer()` could read the
  eagerly-loaded `nodemailer` module before its load promise had settled. It now
  awaits the in-flight load first (throwing the "nodemailer is not installed"
  install-instructions error if the load ultimately failed), matching the guard the
  SMTP path already had.

## 5.1.0

> **If you use `@warlock.js/web`, upgrade.** React did not execute at all in published
> installs of 5.0.0 through 5.0.2 — the defect and its fix are in that package's
> changelog. `core` ships the CLI-side half of this release.

### Added

- **`warlock add tailwind`** — installs and wires Tailwind CSS v4 through PostCSS.
- **`warlock add shadcn`** — sets up the prerequisites shadcn/ui expects. It is *not* a
  wrapper around the shadcn CLI: you still run that yourself to add components, this
  only makes the project ready for it.

### Changed

- **`warlock dev` prints one status block per run.** The banner is printed exactly once,
  and the URL it prints is never a raw `[::1]` address. The single-boot guard behind
  this is **new in this release — it was never present in any published version**, so
  duplicate boots on 5.0.x were real, not a display artefact.
- **`warlock doctor` now reports the same route count as `warlock dev`.** The two walked
  routes differently and disagreed. `doctor` also emits zero warnings on a healthy
  project — so a warning now means something — and fails loudly on a route module that
  genuinely fails to load, instead of counting it as fine.

### Removed

- **A false comment that the `warlock add web` scaffold emitted in 5.0.0 through 5.0.2**,
  claiming a page's route is derived from its file location. No such derivation has ever
  existed. The stub no longer emits it; **apps already scaffolded on those versions still
  carry the comment in their own source** and must delete it by hand.

### Internal

- The `add` feature registry was split into one module per feature, replacing the single
  growing switch.
- Fixed 7 mojibake checkmarks in CLI output.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/core`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/core`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages' changelogs.

## 5.0.0 - 2026-08-25

### Upgrading

- **BREAKING — `Request` no longer has a `[key: string]: any` index signature.** Attaching arbitrary properties (`request.post = post`) no longer compiles. Migrate per attachment: per-request data written by middleware → `request.locals` (augment `RequestLocals`); per-request memoized computation → `requestMemo(key, fn)`; new typed members → module augmentation of `Request` itself
- **BREAKING — `fromRequest(key, callback)` is removed.** It cached values as dynamic `Request` properties, which only compiled because of the deleted index signature. `requestMemo(key, fn)` is the drop-in successor: same per-request lifetime, single-flight (concurrent callers share one promise), and it never touches the `Request` object
- **BREAKING — client-supplied locales are validated against `app.localeCodes`.** A `locale`/`translation-locale-code` header or `locale` query value outside the configured list is treated as absent and falls through to the default locale — it previously won as-is, steering every translated string and every serialized Resource. Apps that declare no `app.localeCodes` keep the pass-through behavior
- **`request.trans()` / `request.t()` now resolve the locale at call time.** Previously the translator captured the locale once during request construction (before routing), so a locale set later — a path locale, `setLocaleCode()` — changed `request.locale` but not the language of translated strings

### Added

- **`request.requireUser()`** — returns the authenticated user non-optionally, or throws `UnAuthorizedError` when no user is attached. For handlers behind an auth guard, where an absent user is a misconfigured route rather than a normal state; replaces `request.user!` assertions

## 4.16.0 - 2026-08-18

### Security

- **`request.detectIp()` no longer trusts `X-Real-IP` / `X-Forwarded-For` unless `http.trustProxy` is set.** Both headers are client-settable, and `detectIp()` honoured them unconditionally — bypassing the `trustProxy` opt-in the Fastify server itself is configured with. Any client could therefore spoof its IP to everything keyed on `detectIp()`: `ipFilter` allowlists/denylists, the default rate-limit bucket key, and anonymous idempotency scoping. Without the opt-in, `detectIp()` (and its `realIp` alias) now returns `baseRequest.ip` — the socket peer address, which cannot be forged

  ⚠ **If your app runs behind a proxy and relied on `detectIp()` reading the forwarding headers without setting `http.trustProxy`, set `http.trustProxy: true`** (or a Fastify `trustProxy` value matching your edge). With `true` set, behaviour is unchanged: `X-Real-IP` first, then the leftmost `X-Forwarded-For` hop, then the peer address. Only enable `true` when your edge overwrites those headers — it trusts them wholesale

- **`http.trustProxy` now accepts a hop count or a trusted-proxy list, and `detectIp()` honours them.** `true` is the wrong shape for the common topology: an edge that *appends* to `X-Forwarded-For` leaves whatever the client prepended as the leftmost entry, so "trust the leftmost hop" hands the client its own IP back. The config value is passed to Fastify untouched, and `detectIp()` now reads the resolved client off `request.ip` instead of re-parsing the header — so both agree, and every Fastify shape works:

  | `http.trustProxy` | Client IP |
  | --- | --- |
  | `false` *(default)* | Socket peer address; forwarding headers ignored |
  | `true` | Leftmost `X-Forwarded-For` entry (whole chain trusted) |
  | `2` | Walks past the 2 rightmost hops — for an edge that appends |
  | `"10.0.0.0/8"`, `"loopback, 10.0.0.0/8"`, `["10.0.0.0/8", "192.168.0.0/16"]` | Walks left while each hop is a listed proxy, stops at the first that isn't |
  | `(address, hop) => boolean` | Your predicate |

  Prefer the narrowest shape your topology allows: with `true`, any client that can reach the process directly picks its own IP, and an `ipFilter` allowlist in front of it is decorative

  ⚠ **`X-Real-IP` is now honoured only under `trustProxy: true`.** It carries no chain, so there is nothing to check a hop count or proxy list against, and a trusted edge that forwards the client's own `X-Real-IP` verbatim would otherwise let any client escape the bound. Under a bounded `trustProxy` the value comes from the `X-Forwarded-For` chain instead — if your edge sets only `X-Real-IP`, have it set `X-Forwarded-For` as well

### Dependencies

- Bumped `@mongez/*` deps to their 2026-08-17 security release specs: `concat-route` ^1.2.0, `config` ^1.2.1, `dotenv` ^1.3.2, `events` ^2.2.7, `http` ^3.5.0, `localization` ^3.4.7, `reinforcements` ^4.0.1, `supportive-is` ^2.1.4
- ⚠ **`@mongez/reinforcements` 4.0.1 is a major bump: `Random` is now CSPRNG-backed (WebCrypto) and `Random.seed()` was removed** — seeded/reproducible `Random.string/nanoid/id/token/uuid` calls now throw. Audited `core`'s `Random.string(...)` call sites (`use-case.ts`, `http/request.ts`, `dev-server/files-watcher.ts`, `http/uploaded-file.ts`) and its test suite: none rely on seeding or reproducible output, so no code changes were required
- `@mongez/encryption` 2.0.1 (async `encrypt`/`decrypt`, throws on failure) does not apply to this package — `core` is not a consumer; `src/encryption/encrypt.ts` uses Node's built-in `crypto` module directly and is unaffected

## 4.14.0 - 2026-08-16

### ⚠ Upgrading from 4.13.0 — read this first

**Three behaviour changes and one documentation correction. All four touch the test lifecycle; none touch application runtime.**

⛔ **Every existing project must replace its `src/test-setup.ts`.** Three things are wrong with the file 4.13.0 generated:

```ts
/**
 * Test Setup
 * Runs before EACH test file — not once per worker.
 */
import { afterAll } from "vitest";
import { setupTest, teardownTest } from "@warlock.js/core/tests";

await setupTest();          // ← was setupTest({ connectors: true })
afterAll(teardownTest);     // ← is new
```

1. **`{ connectors: true }` must become a bare `setupTest()`.** Under the new precedence it is an **explicit** value, so it now overrides your `src/config/tests.ts` where it previously deferred to it.
2. **`afterAll(teardownTest)` is new and is not optional** — without it nothing ever closes the framework your tests started.
3. **The `Per-Worker Test Setup` comment is false.** It always was.

**This is the migration step nobody can skip.** `warlock add test` emits the corrected file for new projects.

| What changes | How you'll see it | What to do |
|---|---|---|
| **`setupTest({ connectors })` now beats `tests.connectors` config** — the precedence flipped | a test file that passes `connectors` explicitly starts a **different connector set** than it did in 4.13.0 | grep for `setupTest({` — a call passing `connectors` was previously **ignored** and is now honoured. **Including the one in your generated setup file** |
| **A second `setupTest` call with different options now REJECTS** | an error naming the active and the requested selection, where 4.13.0 silently did nothing | call `teardownTest()` first, or don't call `setupTest` again at all |
| **The generated setup file now registers `afterAll(teardownTest)`** | your test files tear the framework down when they finish, instead of leaving it running | **add it to your existing `src/test-setup.ts`** — see below |
| **Docs corrected: `setupTest` is called per TEST FILE, not per worker** | no runtime effect on its own — the *invocation* always worked this way | fix the comment in `src/test-setup.ts` as above |

### Added

- **`teardownTest()` — the other half of the pair.** `setupTest` has shipped without a counterpart since it was introduced: there was no supported way to close the framework a test file brought up, and the only "reset" available was a module flag that proved nothing about whether ports, sockets, pools or timers had actually closed

  `teardownTest()` is idempotent when idle, shares one shutdown between concurrent callers, waits for an in-flight setup to settle before closing, and **always clears local state in a `finally`** so a failed shutdown cannot leave the lifecycle claiming to be ready

  ⚠ **A shutdown failure poisons the lifecycle rather than pretending to recover.** If the shutdown layer reports a rejection, later `setupTest` calls refuse until the Vitest worker is recycled or a retried teardown fully succeeds. **We cannot promise a clean restart after a reported close failure, so we don't.** ⚠ **What it cannot see:** `connectorsManager.shutdown()` catches and logs individual connector failures internally — those never reach this lifecycle and never poison it. Manager-wide error policy is a separate piece of work

### Changed

- **BREAKING — an explicit `setupTest({ connectors })` now wins over `tests.connectors` config.** The order was `config > parameter > true`; it is now **`explicit parameter > config > true`**

  4.13.0's changelog said this question was open, not settled: *"a per-call override is a contract decision for a later release."* This is that decision. **Call-site intent should beat a project default** — a caller who names a connector set is being specific on purpose, and silently overruling them was the wrong behaviour

  **"Explicit" means a non-`undefined` value.** `setupTest()`, `setupTest({})` and `setupTest({ connectors: undefined })` **all fall through to config, then to `true`.** The `undefined` rule is deliberate: an optional variable that happens to be `undefined` must not silently erase project config

  ⚠ **The generated `src/test-setup.ts` now calls `setupTest()` with no argument**, where it previously passed `{ connectors: true }`. Under the new order, passing `true` explicitly would erase the `tests.connectors` layer for the entire project. **If you edit your setup file, leave the call bare**

  ⚠ **This is user-visible and it is why the change is marked BREAKING:** an application that sets `tests.connectors` *and* passes `connectors` from any test file will start a different connector set after upgrading

- **BREAKING — a conflicting `setupTest` call rejects instead of being ignored.** While a setup is starting or ready, a call with *different* effective options now rejects with an error naming both the active and the requested selection. The same options remain a no-op, and concurrent identical calls share one startup

  Through 4.13.0 this was a silent early-return on an `isSetupComplete` flag — so `setupTest({ connectors: false })` in a file whose `src/test-setup.ts` had already run **did nothing at all, reported nothing, and started every connector anyway.** Connector arrays are compared as **sets** after deduplication, so caller order never counts as a conflict

- **Lifecycle state is now scoped to the worker runtime instead of the module.** `isSetupComplete` was a module-level variable, and **Vitest rebuilds the setup module's registry between test files while the worker process or thread keeps running** — so the flag reset in exactly the situation where live DB connections, pools and timers survive

  Scope is per **process** under `pool: "forks"` and per **thread** under `pool: "threads"`; it deliberately does not cross thread workers, because `globalThis` is per realm and the resources are per worker too. **The guard's scope now matches the leak's scope in all four `pool` × `isolate` combinations**

### Fixed

- **A stranded setup no longer exhausts the heap.** A lifecycle left in the `starting` state sent `teardownTest`'s wait-then-re-enter path into unbounded recursion — **`FATAL ERROR: JavaScript heap out of memory` at 4 GB, killing the worker with 26 tests in that run never executed.** It was found while proving the state machine, not reported by a user, and it would have shipped

  The setup attempt is now bounded by **`tests.setupTimeout`, defaulting to `120000` ms**, and expiry **poisons** the lifecycle rather than returning it to `idle` — the attempt may have started connectors nobody can now account for. The message names the state, the bound and the remedy:

  ```
  setupTest() did not finish within 120000ms and is stuck in the "starting" state. The
  lifecycle is now poisoned: whatever that attempt had already started is not known to be
  closed, so later setupTest() calls refuse until the Vitest worker is recycled. If your
  cold start is legitimately slower than this, raise the bound with `tests.setupTimeout`
  in `src/config/tests.ts` — milliseconds, default 120000.
  ```

  **It bounds the setup attempt, not teardown separately** — `teardownTest()` awaits the same attempt and inherits the bound. **A second teardown-side deadline was tried and rejected during implementation**: it expired instead of the setup's, was swallowed on settle, re-entered and armed a third, and left the stuck setup unbounded after all — reproducing the exact recursion the guard exists to remove

  ⚠ **An invalid `tests.setupTimeout` throws, naming the value.** Zero, negative and non-numeric fail loudly instead of falling back to the default; a silent fallback hides a typo behind a working suite

  ⚠ **A stranded lifecycle must fail with a message, not a dead process** — a crash mid-file is indistinguishable from an infrastructure flake, which is the worst way for a framework to report its own bug

  ⚠ **Scope of the proof, stated because a green here is easy to over-read:** all nine guards were seen to fail under their own mutation, **but every spec injects its scheduler** — the default *value* is tested while the production timer, and whether its `unref` releases the worker, is not. **No spec observes a real hang**; the stuck attempt is a mock gate, not a socket that never returns

### Documentation

- **Corrected: `setupTest` is CALLED once per TEST FILE, not once per worker.** Every version of the `test-service` and `test-http` skills, both generated LLM projections, the generator's comments and `setupTest`'s own JSDoc described a per-worker lifetime. **Vitest runs `setupFiles` before each test file and their exports are ignored** — measured across all four `pool` × `isolate` combinations, not inferred

  ⛔ **If your project was generated before 4.14.0, replace the whole file** — see the migration block above. It is not a comment-only change

  **The lifetime this release commits to is FILE-SCOPED:** the setup file bootstraps the framework and its `afterAll(teardownTest)` closes it, once per test file. **One owner, one pairing, correct under every pool, every isolation setting, and watch mode**

  ⚠ **This deliberately declines a faster option.** Holding lifecycle state in the worker runtime makes a worker-scoped lifetime *possible* — bootstrap once, reuse across every file in that worker — and an earlier draft of this release simply left the framework running to get it. **We are not shipping that**, for two reasons neither of which is performance:

  1. **Under `pool: "threads"` we cannot honestly claim the runner cleans up.** Vitest tears the thread down while the process lives, and whether Node reclaims that thread's sockets and pools is **unmeasured** — so "the runner owns cleanup by termination" would be a promise we cannot observe being kept
  2. **In watch mode Vitest reuses workers between reruns**, so there is no recycle and therefore **no cleanup owner at all** between reruns. Declaring watch mode unsupported was the alternative, and a test framework whose lifecycle is undefined in the mode people use all day does not have a lifecycle

  **The cost is a framework bootstrap per test file — which is exactly what 4.13.0 already paid**, since its module-level flag died with the module registry between files. **Nothing gets slower; an unearned speed-up is simply not being claimed.** A worker-scoped lifetime remains open, and gets taken when the real per-file cost has been measured on a real application and the runner integration is chosen deliberately rather than inherited from whatever the wiring happened to do

## 4.13.0 - 2026-08-12

### ⚠ Upgrading from 4.12.0 — read this first

**Four breaking changes. Every one of them fails visibly, and every one is fixed by a single line or a single config key.** Three are security defaults that were wrong; the fourth is an import path.

| What breaks | How you'll see it | The fix |
|---|---|---|
| **`http.cors` now actually applies** — it never had any effect in any release through 4.12.0 | requests from origins you never allow-listed start being rejected | check `http.cors` before upgrading; it now means what it says |
| **`http.bodyLimit` defaults to Fastify's 1 MB**, not 200 GB | large uploads that used to be accepted answer `413` | set `http.bodyLimit` explicitly if you need more |
| **`http.trustProxy` defaults to `false`** | `request.ip` becomes the socket address instead of `X-Forwarded-For` | set `http.trustProxy: true` **only if** you are genuinely behind a proxy that strips the header |
| **The package entry no longer re-exports the CLI, dev server, test helpers or Vite integration** | build fails with `has no exported member` | test helpers move to `@warlock.js/core/tests`, `lowerStage3Decorators` to `@warlock.js/core/vite` — **one line per import.** The CLI and dev-server internals are **not** public and have no replacement specifier |

**If your app configures none of the three HTTP keys, the first three changes make it strictly safer with no action from you.** The `trustProxy` default in particular meant per-IP rate limiting was bypassable by anyone sending their own `X-Forwarded-For`.

Details for each are in the entries below.

### Added

- **`build.singleBundle` — one file you can run with `node dist/app.js`.** The default build keeps dependencies as real `import` specifiers resolved from `node_modules`, which is right when you deploy the folder. Producing a single self-contained file previously meant knowing to set `packages: "bundle"` **and** `splitting: false`, and it still did not work

  It sets both as **defaults you can override** — an explicit `splitting: true` in your config still wins. Phase ordering is unaffected: it comes from the generated entry using dynamic `await import(...)`, which the bundler defers to the call site whether or not splitting is on. A comment in the builder claiming ordering "requires `splitting: true`" was wrong and has been corrected

  ⚠ Native `.node` addons cannot be inlined by any bundler and are still emitted alongside the file, so "single bundle" means one JavaScript file plus any native addons — the flag does not promise otherwise

  **Verified end to end on a real application**, not in isolation: the build emits exactly one file, the interop prelude is present, and the result boots and serves a request. This only became possible once dev-only tooling left the production module graph — see the entry below, which is what made `singleBundle` build a real application rather than only a synthetic one

- **`@warlock.js/core/tests` and `@warlock.js/core/vite` are real subpaths**, with their own build entries and `exports` keys — the first version in which those helpers are addressable at all. `/tests` carries the 13 documented test helpers; `/vite` carries `lowerStage3Decorators`

  **The test server's port channel — `publishTestServerPort`, `withdrawTestServerPort`, `TEST_SERVER_PORT_ENV_KEY` — is deliberately NOT part of that surface.** It is how `startHttpTestServer` hands the resolved port to the worker processes that later call `testGet`; it is plumbing, and nothing outside the framework needs it. **Decided before the subpath shipped rather than after, because removing an export once people depend on it is a breaking change**

### Fixed

- **`setupTest()` no longer crashes in a project that has no `src/config/tests.ts`.** `config.get("tests")` resolves an absent key to `null`, and the result was dereferenced — so the very path `warlock add test` generates threw `Cannot read properties of null (reading 'connectors')` before running a single test. **`setupTest()` with no arguments at all** threw one step earlier still, on a destructured parameter with no default

  **`connectors: false` now starts no connectors, as its type and the skill have always said.** The selection read `testConfig.connectors || connectors`, so a configured `false` was discarded, and every non-array value then took the "start all but http" branch — **`false` started everything except http, from config and from the caller alike.** It is now `??` with an explicit `false` check

  ⚠ **Config still beats the parameter:** if `tests.connectors` is set, `setupTest({ connectors })` cannot override it. That is the existing contract and this release does not change it — one line of `skills/test-service` claimed otherwise and has been corrected. **A per-call override is a contract decision for a later release**

- **The request helpers send falsy JSON bodies.** `testPost`, `testPut` and `testPatch` used `body ? JSON.stringify(body) : undefined`, so **`false`, `0`, `""` and `null` — all legal JSON documents — were sent as no body at all.** Only an omitted argument now means "no body"

  **Headers are accepted in every shape `RequestInit` allows.** They were merged by object spread, which is correct only for a plain record — a `Headers` instance or a `[name, value]` tuple list was silently turned into an object with numeric keys and the header was lost with no error. They are now normalised through `new Headers(...)`

  **`Content-Type: application/json` is set only when the helper serialized the body**, and never over a content type the caller set. It was previously forced onto every request, including `FormData` — replacing the multipart boundary the runtime generates and producing a request no server can parse

- **Shutdown survives a throwing log channel.** A connector whose `shutdown()` failed was reported through `log.error(...)` **from inside the catch block** — and `Logger.log()` hands each entry to `channel.log()` with no isolation, so a channel that throws synchronously (a misconfigured transport, an unserialisable payload) made that report reject. The rejection escaped `shutdown()` entirely, and the consequences went well past a missing log line: **`log.flush()` never ran, so every buffered entry from the whole run was lost; the remaining connectors were never torn down; and `process.exit(0)` — the line `gracefulShutdown` runs once `shutdown()` resolves — was never reached, leaving the process alive on the handles those connectors still held**

  ⚠ **This hardens the shutdown path, not the logger.** `Logger.log()` still aborts its fan-out on the first throwing channel, so the other channels never receive that entry, and an *asynchronously* rejecting channel is not covered at all — `channel.log()` is never awaited. **Logger-wide isolation is a separate fix in a later release**

- **A test server that fails to start no longer leaves half of itself running.** `startHttpTestServer()` publishes the resolved port before the late connector phase and sets `isServerRunning` only on its last line, so a failure in between left **live early-phase connectors and a published port pointing at a server that never came up** — while `stopHttpTestServer()` in `globalTeardown` reported *"No server to stop"* and walked away from them. Startup now unwinds what it started, always withdraws the port and resets its state. ⚠ **The error you get back is unchanged — it always was.** Startup had no `catch` at all, so the original failure already propagated correctly; what was missing was the cleanup, and the new `catch` exists only to run it. A failure *during* that cleanup is reported and never substituted for the cause, which is the one propagation guarantee the wrapper had to be careful not to break

  **`stopHttpTestServer()` withdraws the port and resets state in a `finally`.** They previously ran after the `await`, so a shutdown that threw left the published port behind and the next run in the same process inherited it

- **`startHttpTestServer({ port: 0 })` is refused with an instruction instead of half-working.** `0` is the OS's "pick a free one" idiom, and the test server cannot honour it: the preflight would bind some unrelated ephemeral port and pass without proving anything, and nothing publishable exists afterwards — `HttpConnector.start()` records the port it **asked for**, not the one Fastify bound. Accepting it silently meant `getTestServerUrl()` resolved `0` through its own config fallback and **every worker request went to `http://host:0`**, where nothing listens. The error names the fix: pass an explicit port, or set `http.port`

- ⚠ **BREAKING — the package entry no longer re-exports the CLI, the dev server, the test helpers or the Vite integration.** Five `export *` lines are gone from `@warlock.js/core`'s root: `./cli`, `./dev-server/files-orchestrator`, `./dev-server/health-checker`, `./tests` and `./vite`

  **Why it had to change:** those five put dev-only tooling into the **static module graph of every application that imports the framework** — 39 files, reaching ESLint and, through it, ESLint's optional `jiti` import. It cost nothing while the builder kept `packages: "external"`, because esbuild never walked into the framework. **Anything that bundles walks it, and the build fails.** That is why `singleBundle` could not build a single real application

  ⚠ **Making those imports lazy does not help and should not be attempted.** esbuild resolves `import()` at build time; a dynamic import defers *evaluation*, not resolution. Measured: `await import("jiti")` in an otherwise empty file still fails with `Could not resolve "jiti"`. **Only unreachability from the entry removes a module from the graph**

  **The two public halves are now reachable from a subpath — and in 4.12.0 and earlier they were reachable from nowhere at all.** `./tests` and `./vite` are **real build entries with their own emitted files and `exports` entries**, not reachable from the root barrel, which is the entire point:

  ```ts
  // before                                        // after
  import { setupTest } from "@warlock.js/core";     import { setupTest } from "@warlock.js/core/tests";
  import { startHttpTestServer } from "@warlock.js/core";
                                                    import { startHttpTestServer } from "@warlock.js/core/tests";
  import { lowerStage3Decorators } from "@warlock.js/core";
                                                    import { lowerStage3Decorators } from "@warlock.js/core/vite";
  ```

  **The CLI and dev-server internals are different — they were never a public API and have no replacement specifier.** If you were importing from those, you were reaching into framework internals; open an issue describing what you needed.

  ⚠ **If you were importing these symbols in 4.12.0, they were already not in the published package.** `esm/tests/` and `esm/vite/` did not exist in the 4.12.0 artifact, and none of those symbols appear in `esm/index.d.mts` — **the root barrel re-exported source the build never emitted.** So this is the release that makes them installable, not the one that removed them.

  `Path` is unaffected — it moved to a genuine utility module and remains exported

  **Removing the five lines was necessary but not sufficient.** Three production modules — `connectors/http-connector`, `connectors/connectors-manager` and `warlock-config/warlock-config.manager` — imported the dev server's console formatter directly. In `http-connector` the dev-console call was simply **deleted**: the same error was already routed through `log.fatal` on the following line. `connectors-manager` now logs a connector's shutdown failure through `@warlock.js/logger`, **awaited and then flushed** — `process.exit(0)` follows immediately, so an un-awaited log is a log that never happens. `warlock-config.manager`'s *"`warlock.config.ts` is missing"* warning writes **straight to the console instead**: it runs during CLI bootstrap, before the logger has a single channel configured, so routing it through the logger would drop it in every application

  `tests/unit/meta/production-entry-graph.test.ts` enforces this from now on. It keys on **our own directory names** rather than a denylist of third-party packages, because a denylist rots the moment a dependency changes its imports and can only catch names someone thought of

- ⚠ **BREAKING — the CORS allow-list in `http.cors` now actually applies.** The framework's defaults were spread **after** your configuration, so `{ origin: "*", methods: "*" }` overwrote whatever you set. **`http.cors` has never had any effect**, in any release up to 4.12.0 — an app that configured an allow-list still answered every origin. Your configuration now wins

  **This is breaking in the direction you want, but it is breaking:** an app that has been relying on the accidental `origin: "*"` while believing it was restricted will now restrict. Check your `http.cors` before upgrading

  Worth knowing why the old behaviour was also broken for the legitimate case: `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true` is a pair **browsers reject**, so a cross-origin `fetch(…, { credentials: "include" })` failed outright. The default was simultaneously too open for unauthenticated reads and unusable for authenticated ones

- ⚠ **BREAKING — `http.bodyLimit` no longer defaults to 200 GB.** An app that configures nothing now gets **Fastify's own 1 MB limit**. The previous default did not merely allow large bodies, it **replaced a protection Fastify provides**: an unauthenticated endpoint accepted a 5 MB body and ran application logic on it where bare Fastify would have answered `413`

  **If you accept uploads, set `http.bodyLimit` before upgrading** — otherwise those requests start failing with `413`. The failure is immediate and one config key fixes it

  The old comment recommended `middleware.maxBodySize()` for per-route caps. **That middleware cannot do this job** and its documentation has been corrected: framework middleware runs inside the route handler, after `@fastify/multipart` has already parsed the body, so it can report `Content-Length` but cannot refuse the read. For a real per-route cap use `serverOptions.bodyLimit`, which Fastify enforces while reading

- ⚠ **BREAKING — `http.trustProxy` now defaults to `false`.** `request.ip` was derived from the client-supplied `X-Forwarded-For` header by default, and `@fastify/rate-limit` keys its buckets on `request.ip` — so **a client sending a different `X-Forwarded-For` on each request got a fresh rate-limit bucket every time.** Any deployment not behind a proxy that strips the header had bypassable rate limiting, and the same applied to per-IP lockouts and audit logs

  **If your app is behind a proxy, set `http.trustProxy = true`.** Until you do, `request.ip` reports the proxy's address rather than the client's — a visible, diagnosable change, unlike the previous default, which could not be detected from inside the application

- **Per-route `serverOptions` are no longer discarded by the dev server.** `scanDevServer` registers wildcard routes and dispatches per request, so it had no per-route registration slot and dropped `serverOptions` entirely. A route declaring `serverOptions.onRequest` — the documented way to run **before body parsing** — worked in production and **silently never ran in dev**, which is the only mode most teams run. `route.rateLimit` was dropped the same way, since it rides in the same options object

  Matching now happens in Fastify's own `onRequest` phase and the matched route's hooks run there, so `onRequest`, `preValidation` and `preHandler` are forwarded with their pre-parse ordering intact

  ⚠ **Two options still cannot be forwarded in dev, and `serverOptions`' documentation now says so rather than implying otherwise:** `bodyLimit`, because Fastify reads it at registration time and no hook can bound a body already being parsed; and `preParsing`, because it must return the payload stream. For a pre-parse guarantee that holds in both modes, register a server-level hook via `router.beforeScanning` — it must be idempotent per request, since a connector restart builds a new server and runs the callback again

- **The dev server no longer rebuilds its entire route registry on every request.** A comment claimed the registry was initialised "once" and pointed at a `rebuildRouteRegistry` function that **does not exist**; the code sat inside the per-request handler, re-registering every route on every hit — and `router.any()` routes expand into seven registrations each. It is now built once and rebuilt when the route table changes

- **The dev dispatcher logs through the framework logger instead of `console.log(error)`,** with the request method and url attached

- **A bundled production build no longer succeeds and then dies at startup.** Setting `packages: "bundle"` produced a clean build whose process failed immediately with `Error: Dynamic require of "node:assert" is not supported`. Warlock's output is an ES module; bundled CommonJS dependencies call `require(...)` and read `__dirname` to locate their own assets, and neither exists in an ES module, so the bundler substituted a stub that throws. The only fix available to an application author was to hand-write an esbuild `banner` recreating `require` via `createRequire(import.meta.url)` — esbuild internals no app should need to know

  The interop prelude is now injected automatically for **any** ESM build (`build.esmShim`, default `true`), not only under `singleBundle` — so a hand-written `packages: "bundle"` works too. It defines `__filename` and `__dirname` as well as `require`: a dependency resolving an asset path with a missing `__dirname` gets `undefined` and fails later, further from the cause

  **An existing hand-written `banner` is preserved.** esbuild's `banner` is an object and every merge on the way to it replaces rather than merges, so previously whichever was applied second silently deleted the other. The shim is prepended to your banner instead

## 4.12.0

### Added

- **`warlock migrate --pending` — what will run next, in the order it will run.** `migrate` could report what had already run (`--list`) and what files existed on disk (`--all`), but not the one thing an operator asks before a schema change against a live database. The pending set was already computed on every migrate run; it simply had no read-only exit

  The gap forced a workaround that is **unsound in the dangerous direction**. `--all` globs `src/app` only, so it cannot see migrations a *package* registers through `database.migrations` — `@warlock.js/auth` alone contributes two. `--list` reads the migrations table, which does contain them. Differencing the two counts subtracts populations that do not overlap, and it under-counts pending by roughly the number of package migrations installed — reporting "nothing else is pending" when something is

  **`migrate --list` now prints both sections**, executed and pending, so the question can be answered without knowing a second flag exists. The executed section prints **first and unconditionally**: it is a table read that cannot fail because of a broken file on disk, and `--list` is the command reached for while something is already wrong. `--list` always exits `0` — it is a report

  **`--pending` is the gate**, and its exit code is its entire API: **`0`** computed and nothing pending, **`1`** computed and N pending, **`2`** could not be computed. Two codes would fold "three migrations are waiting" into "I could not work out what is waiting", and those demand opposite responses — the first is *run them*, the second is *stop*. `migrate --pending && deploy` behaves correctly under all three

  **A failure to read the migrations never reports `0`.** Computing pending requires loading project code, and a single migration file missing its default export throws. That degrades to an explicit `Pending: unavailable — <reason>` line with the executed listing intact above it, and `--pending` exits `2`. An empty pending set means *nothing is pending*, and nothing else

  `--all` deliberately does **not** gain a migration name beside each path. The only identifier available without loading is the one derived from the filename, and that derivation is a *fallback* used when a migration does not set `migrationName` — so any migration that names itself (`auth`'s do) would be listed under a name that does not exist. A wrong identifier in a listing whose purpose is cross-referencing is worse than no identifier, and `--list`'s two sections answer the comparison directly

  Proven against a real Postgres: an executed package migration and a pending local one land in the correct sections, a fully-migrated database reports an empty pending list rather than an absent one, and the reporter's `files − executed` arithmetic is pinned as a test that fails if it is ever reintroduced

### Changed

- `migrate`'s preload block no longer declares `env: true`. The flag has done nothing since env began loading for every command that declares a preload block; it was decoration, and the test suite now asserts its **absence** so it is not re-added by someone reading the still-deprecated type

- **The package now declares its own test runner and a `test` script.** `@warlock.js/core` shipped a maintained `vitest.config.ts` — aliasing eight sibling packages to their sources — with **no `devDependencies` key at all** and no way to invoke it. Its suite was reachable only by knowing to type `npx vitest`, which resolves whatever happens to exist in the tree rather than anything the manifest asked for. The runner is pinned to an **exact** version, not a range: it moved from 4.1.8 to 4.1.10 mid-development on an unrelated install, silently, and a suite whose runner can change underneath it proves less than it appears to

### Fixed

- **A build artifact that names an entry point it does not contain is now refused before it can be packed.** An interrupted build leaves a directory that looks finished — `package.json`, `README`, `CHANGELOG`, `bin/`, `skills/` — and holds no compiled code at all. Nineteen existed in this tree at once, and nothing in the release path noticed: the only related guard compares **modification times**, so a hollow directory with a freshly written manifest is *newer than source* and passes, and it runs solely on the artifact-reuse path, which is not how the hollow directories were produced

  Each artifact is now verified immediately before `npm pack`, on the normal build path and the reuse path alike. **The manifest is the specification:** `main`, `module` and the typings field name the exact files the package promises to ship, so they are resolved against the artifact and must exist. Fields a manifest does not declare are skipped — `core` and `auth` point `main` at `esm/` while `cascade`, `ai` and `seal` point it at `cjs/`, and any check that assumed one build shape would have raised a false failure on packages that are entirely correct. A manifest declaring no entry point at all is also a failure: a published package nothing can import is not a package

- **The production acceptance gate no longer inherits the environment it is supposed to be testing.** `run-pnpm-acceptance.mjs` spawned every child with `env: { ...process.env }` and set no `NODE_ENV`. It exercised the production path only because the shell it was written in happened to carry `NODE_ENV=production`; on a clean checkout, a new contributor's machine, or CI, the same gate boots the app in **development** — and does not fail, it passes while testing something other than the thing it is named after. That is the worst outcome available to a gate, and it sat underneath the proof for 4.11.0's headline fix

  `NODE_ENV=production` is now set explicitly on every spawn, and — more importantly — **asserted from inside the running app**: `/acceptance` reports the environment it actually booted in, and the run fails if it is anything else. Setting a variable and never checking it arrived is how the original defect survived. The remaining `{ ...process.env }` is documented as a deliberate inheritance of `PATH` and the package-manager store paths, with everything the *verdict* depends on set after it

  Consequence for the roadmap, recorded because the ordering matters: **CI wiring for this gate is now blocked on this fix, not parallel to it.** Wiring it up first would have produced a green from CI — which carries more weight than a local one — for a run that never touched the production path

- **`warlock migrate --rollback=false` no longer drops every table.** CLI options were parsed as raw strings and nothing ever coerced them: `--rollback=false` reached the action as the string `"false"`, `if (rollback)` saw a truthy value, and the run rolled back *everything*. The declared `type: "boolean"` on the option was decorative — used only to render help. The same shape existed on every boolean option, including `warlock drop.tables --force=false`, where it turned a confirmation prompt into an unattended drop

  Its twin was worse. A bare `--flag` swallowed the following token as its value, so `warlock migrate --rollback 2024_users.ts` produced `rollback: "2024_users.ts"` — the filename was never read as a path, and every table went down while the operator believed they had named one file. **A declared boolean now never consumes the next positional**: `--rollback 2024_users.ts` is `rollback: true` plus the positional `2024_users.ts`

  Coercion is **type-aware, driven by the command's own declared options**, not a blanket rule in the parser: `--flag` → `true`, `--flag=true|1|yes` → `true`, `--flag=false|0|no` → `false` (case-insensitive), and short aliases (`-r=false`) behave identically. A string-typed option whose value is genuinely the word `false` — `--name=false` — still arrives as the string `"false"`. Options a command does not declare are untouched

  **An unreadable value is an error, not a guess.** `--rollback=maybe` prints what was invalid and what is accepted, and exits 1. Guessing is what produced this defect; a flag that gates a destructive action must refuse input it cannot read rather than pick a side

  `parseCliArgs` now takes an optional schema and runs twice: once bare to discover the command name (behaviour unchanged — there is no command to consult yet), then again against the resolved command's options. Re-reading argv is what makes the swallowed positional recoverable; by the time the first pass returns, a swallowed argument is indistinguishable from a value

- **`warlock generate.module users --force=false` no longer overwrites your files.** The coercion above is opt-in by design — it applies only to options a command declares `type: "boolean"`, so a string option whose value is genuinely the word `false` survives. The generate family and `add` never carried that declaration, so the fix reached none of them and both faces of the defect stayed live on the commands most likely to be run against existing source

  `--force=false` arrived at every generator as the truthy string `"false"` and the overwrite guard (`if (exists && !force)`) let it through — a flag written to *prevent* clobbering did the clobbering. Its twin ate the target: `warlock generate.module --force users` parsed `users` as the value of `--force`, so the module name was lost entirely and the generator ran with no name

  Twenty-three option declarations are now typed: `--force, -f` and `--dry-run` on all eight `generate.*` commands, plus `--minimal, -m`, `--with-validation, -v`, `--with-resource, -rs`, and both `--timestamps [bool]` declarations, and `--list, -l` / `--no-install` on `add`. Options that carry real data are deliberately untouched and still take a value — `--table`, `--add`, `--drop`, `--rename` on the generators, `--package-manager` on `add`, and `seed --drop="Seed Name"`, whose value scopes which seeder is undone

  `add --no-install` no longer has to be passed last. That instruction was in its help text only because the bare flag used to swallow the feature that followed it; `warlock add --no-install auth` now records `auth` as the feature and skips the install, and the wording is gone

  The guard drives the real command objects through the manager's own resolution path (`tests/unit/cli/generate-flag-options.test.ts`) and asserts what the action is handed. Asserting the declaration object instead would pass against a fixture while the CLI stayed broken

- **`new Image(...)` no longer fails depending on how soon you call it.** The `Image` module fired `import("sharp")` at load time without awaiting it, and the constructor only checked whether that import had *failed* — never whether it was still in flight. Constructing an image in the first tick after importing the package therefore ran with an undefined sharp function and died with `TypeError: sharpFn is not a function`; the exact same code passed if something had awaited a timer first. Anything that builds an image during boot — a startup thumbnail job, a module-level warm-up — hit it, and it presented as a mysterious "works locally, breaks in prod" timing bug rather than as a missing dependency

  Sharp is now resolved **synchronously on the first construction that needs it**, via `createRequire`, and the outcome is cached for the process. There is no longer a window in which the constructor can proceed without a real sharp function: it either has the module or throws. A missing sharp still throws the same install-hint error, at the same point (construction), with the same wording

  Resolution stays **lazy** — importing `@warlock.js/core` still does not load sharp's native binary, so apps that never touch images pay nothing — and constructing an `Image` from an existing sharp instance short-circuits before any module load

  The guard for this is a spawned fresh Node process that imports and constructs with nothing in between (`tests/unit/image/image-sharp-resolution.test.ts`). A same-process test cannot catch it: importing at collection time and constructing later *is* the delay that hides the bug

- **A sharp that is installed but will not load no longer reports itself as "not installed".** The resolution above swallowed every failure into a single outcome, so the most common real-world sharp problem — the package present but its native binary built for another platform — arrived as `sharp is not installed.` plus instructions to run `npm install sharp`, which cannot fix it. sharp throws its own long, actionable error naming the runtime, the failing `.node` file and the exact install flags to use; that text was discarded and replaced with a different, wrong cause

  Only **genuine absence** now produces the install hint: a `MODULE_NOT_FOUND` whose message names the specifier `'sharp'` exactly. Matching on the code alone is not sufficient — a dependency missing *inside* sharp raises the very same code (`Cannot find module 'color'`), and would have been reported as sharp itself being absent. Any other failure surfaces sharp's own message, inlined as `Failed to load "sharp": …` **and** chained as `cause`, so a terminal that never prints `cause` still shows the text that helps. The absent-sharp path is unchanged, wording included

  **The failure reason is cached, not just the fact of failure.** The resolution attempt runs once per process; a second `new Image(...)` skips the load entirely, so caching only "there is no sharp function" would have re-told the same lie one call later. The guard therefore constructs **twice** in each spawned process and asserts the second error matches the first (`tests/unit/image/image-sharp-load-failure.test.ts`) — a one-shot test passes even with that bug present

  The `MODULE_NOT_FOUND` shapes the guard feeds in are produced by asking Node for a module that genuinely is not installed, rather than hand-written, so the matcher is tested against Node's real message text

- **`renderReact()` no longer renders against modules that have not loaded yet.** The same defect as the two above, in a second module, found by looking for the pattern rather than by a bug report. `react/index.ts` fired `import("react")` and `import("react-dom/server")` at load time without awaiting either, and tracked them with a three-state flag that the guard only tested for one state: `if (moduleExists === false)`. While the imports were in flight the flag was `null`, which is not `false`, so the guard passed and the synchronous `renderReact` read `createElement` off `undefined`. With two sequential dynamic imports the window is wider than the image module's, and it is open during exactly the work a server does at boot — rendering a page or an email template from a module-level warm-up

  The window swallowed the diagnostics as well as the render. A genuinely missing react did **not** produce the install hint during that window: it produced `TypeError: Cannot read properties of undefined (reading 'createElement')`, because the flag was still `null` rather than `false`. The install instructions only appeared for callers late enough to have missed the race — the callers who least needed telling

  Both modules are now resolved **synchronously on the first `renderReact()` that needs them**, via `createRequire`, with the outcome cached for the process. Resolution stays **lazy**: importing `@warlock.js/core` still does not pull react into apps that never render. A genuinely absent react throws the same `react is not installed.` message with the same instructions, unchanged

- **A broken `react-dom/server` no longer reports itself as `react is not installed`.** The two packages were loaded in one `try` and collapsed into one flag, so any failure of either was attributed to react. The specifiers are now resolved and reported **separately**, and the message names the one that actually failed — `Failed to load "react-dom/server": …` — because sending an operator to reinstall react when react is fine costs them the debugging session. Absence is distinguished from breakage the same way as for sharp: `MODULE_NOT_FOUND` **and** a message naming the specifier exactly, quoted, which is also what stops `'react-dom'` from satisfying a check for `'react'`. Everything else surfaces the original error, inlined and chained as `cause`. A `react-dom` whose `./server` subpath is missing from `exports` raises `ERR_PACKAGE_PATH_NOT_EXPORTED`, so it correctly reports as an incompatible install rather than an absent one

  As with sharp, the failure **reason** is cached rather than only the fact of failure, so the second call cannot fall through to the "not installed" branch and re-tell a lie the first call got right

  The guard is a spawned fresh Node process (`tests/unit/react/react-module-resolution.test.ts`); a same-process test cannot catch this, which is why the pre-existing suite was green against it. Against the live bug all five cases failed, and — the detail that shows how much the race hid — all five failed with the *same* `Cannot read properties of undefined` symptom, including the case that only asserts the install message. The present-but-broken states are staged by copying the module source next to a fixture `node_modules`, since resolution anchors to the importing file; the real workspace is not mutated

## 4.11.0

### Added

- `startHttpTestServer({ port })` — run an integration suite on an explicit port, honoured over `HTTP_PORT` in `.env`, which the internal bootstrap re-reads and no caller could previously override
- the test server preflights its port and fails with "stop the dev server" naming the port, instead of a raw `EADDRINUSE` from inside Fastify
- `Application.setServedPort()` and a `port` field on the readiness signal, so a supervisor learns the bound http port from the app rather than re-deriving it from config it may not be able to read
- `setConfig(name, value)` — the write side of the config store, exported separately from the read-only `config` accessor so registering configuration stays a deliberate boot-time act

### Changed

- `@mongez/dotenv` is now required at `^1.3.1` (was `^1.2.4`). Under the old range a fresh install resolved to 1.3.x while an existing lockfile could stay on 1.2.x, so we could not say which behaviour a given consumer actually had. 1.3.x only changes cases that were previously wrong: `env()` now consults `process.env` instead of returning a default for a key the environment defines, `${VAR}` interpolation throws naming the key instead of baking the string `"undefined"` into a value, and numeric coercion no longer corrupts values like `0123456789` or IDs beyond 2^53. Precedence between `.env` files and injected variables is unchanged

  Core keeps its own guard for a missing `.env` regardless of which version resolves — an application can pin its own transitive dependencies, so the installed version is never something core can assume

### Deprecated

- the `env` preloader flag on a CLI command is no longer read — env is loaded for every command that declares a preload block. Setting it is harmless and does nothing; remove it. Dropped at 5.0

### Fixed

- **A production bundle no longer imports a package your app does not declare.** `warlock build`'s generated config loader emitted `import config from "@mongez/config"` — one of *core's* dependencies, never the app's. npm and yarn hoist flat so it resolved by accident; under pnpm's strict layout the shipped bundle died at boot with `ERR_MODULE_NOT_FOUND` for a package the app had no reason to install. The generator now emits `setConfig` from `@warlock.js/core`, which the app does declare, and Node resolves `@mongez/config` from core's own install — correct under pnpm, and portable, unlike baking absolute paths into an artifact meant to be copied between machines

  **The rule is now enforced, not just followed.** `warlock build` fails if any specifier written into generated code is missing from the app's `dependencies`, listing every violation at once. Rewriting the one bad import fixes today's bundle; the check is what stops the next change to the generator from reintroducing it invisibly — under npm and yarn the mistake never surfaces

  Two scaffolding sites had the same defect and are fixed with it: `warlock generate.module` emitted `groupedTranslations` from `@mongez/localization`, and the communicators config stub emitted `env` from `@mongez/dotenv`. Both now come from `@warlock.js/core`, which already re-exports them

- **`env()` inside `warlock.config.ts` no longer always returns its default.** The config module was evaluated *before* any `.env` file was read, so a project following the documented `build: { outdir: env("BUILD_OUT", "dist") }` recipe silently got `dist` no matter what the environment said — under every command, `dev` included, and under `build` and `start` env was never loaded at all. Env files are now loaded before `warlock.config.ts` is evaluated, for every command

  Loading is guarded: a project with no `.env` is legitimate and must not start failing `warlock build` now that env loads everywhere. `NODE_ENV` remains authoritative for which file is chosen — no command forces the environment, so a deliberate `NODE_ENV=staging` build still reads `.env.staging`. With `NODE_ENV` unset, plain `.env` is read

- **An application without `src/config/storage.ts` can boot again.** The storage connector starts unconditionally, on the documented grounds that `storage.init()` falls back to a built-in `local` driver so file storage works out of the box. That fallback was never implemented: `init()` resolved the default driver *name* and then found nothing registered under it, so any app without a storage config died at boot with `Storage driver "local" is not configured`. A built-in `local` driver rooted at `uploadsPath()` is now registered before configured drivers — so an app defining its own `local` still overrides it, and naming a driver that genuinely does not exist still fails loudly

  Only scaffolded apps hid this, because `create-warlock` always ships a storage config

- `startHttpTestServer` no longer breaks a suite that configures `http.port: 0`. `0` is the OS's "pick a free port for me" idiom, but the guard only checked `typeof port !== "number"`, so `0` fell through: the preflight bound an unrelated ephemeral port and passed without proving anything, and `0` was then published as the bound port, pointing every request in the suite at `http://host:0`. An explicit `0` now takes the same path as no configured port — no preflight, nothing published, Fastify picks the port

- **`warlock start` no longer claims success before the app has booted.** The startup banner printed in `preAction` — before the child process was even spawned — and the failure that followed went only to stderr. Any CI gate or process supervisor that watches stdout for the banner read a 🔴 boot failure as a healthy start, which is how a production app that never booted was recorded as running. The banner now prints only when the application reports a completed boot, and a child that dies before reporting is a failed start: the message goes to **both** stdout and stderr, and the exit code is forced non-zero even when the process itself exited `0`

  Readiness is signalled, never assumed. `Application.markBooted()` sends a versioned `warlock:ready` message — `{ type, version, pid, at, environment, runtimeStrategy, bootDurationMs?, port? }` — over the IPC channel `warlock start` opens, and closes that channel immediately so an open handle can't keep a wedged process looking alive. The signal is gated on a `WARLOCK_BOOT_SIGNAL` handshake the CLI sets on the child it spawns, so an app running under pm2 or any other supervisor never writes into a channel it does not own

  A bundle built by an older Warlock has no readiness signal. It still starts normally and draws a note on **stderr only** telling you to re-run `warlock build` — an absent signal is never an error, never fails a run, and never kills a slow boot

  **Upgrading:** re-run `warlock build` so the bundle can report readiness; until you do, `warlock start` runs your app but prints no started banner. Anything parsing `warlock start` output should note that progress lines now go to stderr — stdout carries the started banner and start failures, nothing else

## 4.10.0

### Changed

- **`response.cookie` is now secure by default** — `httpOnly: true`, `sameSite: "lax"`, and `secure: true` outside development are applied unless overridden. Previously nothing set them: a cookie was readable by any injected script, sent in cleartext, and attached to cross-site requests unless the developer knew to pass three flags on every call. Nothing failed when they were missing, so the app worked and was simply insecure. Precedence is framework defaults → `http.cookies.options` → the per-call argument, so opting out stays possible and explicit. `secure` is relaxed only in development, because browsers drop a `Secure` cookie over plain http

  **Upgrading:** a cookie your client-side JavaScript reads now needs `{ httpOnly: false }` stated explicitly. Anywhere you wrote `secure: Application.isProduction` by hand can be deleted — the default already tracks the environment, and the hand-written form wrongly disables `secure` in test and staging

## 4.9.2

### Fixed

- the dev server's generated `.warlock/loader-hook.mjs` no longer ships bare `esbuild` / `get-tsconfig` imports. That file is written into the **consuming app's** directory, so a bare specifier resolves from the app — but both packages are core's own dependencies. npm and yarn hoist flat so it worked by accident; under pnpm's strict layout the dev server died with `ERR_MODULE_NOT_FOUND` for a package the app never imported. Each npm specifier is now rewritten at generation time to an absolute path resolved from core's own install, so no consumer has to declare a phantom dependency

## 4.9.0 - 2026-08-06

### Added

- `warlock dev` keyboard shortcuts — `r` restart, `c` clear, `q` quit, `h` help — armed once the server is ready and listed by `h`. TTY-gated, and `Ctrl+C` keeps working while raw mode is held
- press `u` on the `warlock dev` update notice to update every `@warlock.js/*` dependency, install, and restart the server in place — no Ctrl+C round-trip. Falls back to the printed `npx warlock update` command when the terminal can't deliver keypresses (CI, piped stdin, supervisors)
- `warlock dev` now runs as a supervised pair — a thin parent that owns the terminal and a disposable worker — so restarting replaces the worker instead of stacking a process per restart, and the supervisor never loads config or connectors
- `warlock dev` restarts automatically when `warlock.config.ts` or any `.env*` changes, since neither can be hot-reloaded; opt out with `devServer.restartOnConfigChange: false` for the previous warning
- Bun support in `warlock update` and `warlock add` — `bun.lock` / `bun.lockb` are detected and drive `bun install` / `bun add`
- `warlock dev` recovers from a crash: a worker that dies after running healthily for 5s is replaced automatically, while one that dies during boot is left alone so its error isn't buried under a reprint. Capped at 3 crashes per minute
- `warlock update --dry-run` reports what would change without touching anything, and `--check` does the same but exits `1` when a package is behind — a CI gate for staying current

### Changed

- the dev-server update check remembers npm's answer for 24h in `.warlock/update-check.json`, so a day of restarts costs one lookup instead of one per boot; failed lookups are never cached, and the entry is dropped once an update is applied

### Fixed

- `warlock start` spawns `process.execPath` instead of a bare `node`, which failed with `ENOENT` wherever `node` is not on `PATH` (systemd units, cron, slim containers) and could otherwise pick a different Node version than the one running the CLI
- `warlock add` no longer carries its own package-manager detection that silently produced an undefined install command when the project had no recognised lockfile — it shares the updater's detection
- `build.outDirectory` — the name the docs have used for several releases — is now actually read. Only `build.outdir` ever was, so a config written from the documentation was silently ignored and the bundle still went to `dist/`. Both names now work (`outdir` wins if you set both) and the docs lead with `outdir`
- `warlock update` no longer reports "All @warlock.js packages are already up to date" when it never reached the npm registry — an offline run now says so and changes nothing
- a failed package-manager install during `warlock update` no longer loses the rewritten `package.json`; the CLI still exits non-zero
- the dev server's update check now uses a 5s abort budget instead of 30s, so a hanging network can't leave a pending request behind a running server

## 4.8.1 - 2026-07-21

### Fixed

- `@warlock.js/ai`, `@warlock.js/access`, and `@warlock.js/notifications` declared as optional `peerDependencies` (matching the existing `@warlock.js/herald` pattern) so pkgist's bundler leaves them external instead of vendoring their source into core's own build — a vendored `@warlock.js/ai` copy was a disconnected module instance whose config listeners (e.g. `ai-panoptic`'s dashboard wiring) never received `ai.config(...)` calls routed through the real, separately-installed package

## 4.6.1

### Fixed

- a fatal `uncaughtException` at production boot (e.g. a config file that throws) is no longer swallowed into a silent `exit 0` — bootstrap now wires the crash handler to exit non-zero in production so `warlock start` surfaces the failure; the dev server still logs-and-continues for HMR

## 4.6.0

### Added

- release-hygiene tests: version↔changelog invariant + generator-stub import check
- `router.routeCount()` exposes the number of registered routes as a boot/readiness signal
- `health.addRoutesRegisteredCheck(getRouteCount)` registers a readiness check that reports not-ready when a booted HTTP app has zero routes
- seeders now receive a `{ track }` context — `track(model)`, `track(models[])`, and `track(table, id)` register created records (each call returns its argument so it can be chained inline); `recordsCreated` is auto-derived from the track count
- `seed_records` table (created via the new `SeedRecordsTableMigration`) records every tracked seed reference within the same transaction the seed runs in; only the last run's refs are kept per seeder
- `warlock seed --drop [name]` undoes a seed: deletes its tracked records in reverse run/insertion order inside a transaction, then resets the matching seeds-log rows so `once: true` seeds re-run; scope to one seeder with `--drop=<name>`
- `Seeder.dependsOn` is now resolved — seeders are topologically sorted so dependencies run before dependents, layered over the numeric `order` tie-break; throws `UnknownSeederDependencyError` for a missing dependency and `SeederDependencyCycleError` for a cycle
- seeders receive an injectable clock and a meaningful batch size — `run({ track, now, batchSize })`; `now()` (default `() => new Date()`) drives both seed data and the seeds-log timestamps so historical/back-fill runs are deterministic, and `batchSize` surfaces the seeder's own `batchSize` for `Model.createMany(rows, { batchSize })`
- repository-level aggregation — `aggregate()`, `sum()`, `avg()`, `min()`, `max()`, and `groupBy()` on `RepositoryManager`, each reusing `filterBy` (and its operator-injection guard), `where`, and scopes before the aggregate, exactly like `count()`
- `warlock doctor` — a read-only diagnostics command that runs routes / config / connectors / optional-peers / health / release-hygiene checks and prints a pass/warn/fail report (exits non-zero on any failure, never opens a DB/cache/socket connection)
- `warlock routes` — a read-only command that lists the registered HTTP routes as a verb-colored table (method / path / name / action / middleware-count / source); filter with `--method` / `--path` / `--name`, or emit the normalized rows as JSON with `--json`. Boots app code to register routes but starts no connectors

### Changed

- `Seeder.run` now receives a `SeedContext` (`run(ctx)`) — backward compatible, an existing zero-arg `run()` keeps working unchanged

### Fixed

- route-module load/registration failures are no longer swallowed: a route file that throws on import or registration now surfaces loudly instead of silently 404'ing the whole surface
- `ModuleLoader.loadModule` rethrows after logging (wrapped in a new `ModuleLoadError` carrying the failing file + cause), so a broken module aborts boot and is caught loudly by the HMR batch-reload handler in dev
- `ModuleLoader.loadAll` aggregates per-file failures and throws an `AggregateError` at the end, so one broken module no longer hides the others
- `router.withSourceFile` rethrows the callback error after logging instead of consuming it with a bare `console.log` (the `try/finally` source-file stack cleanup is preserved)

## 4.5.0

### Changed

- dev-server update notice now fires immediately on `warlock dev` — the check is spawned in parallel with server startup instead of awaiting it, so the notice surfaces as soon as npm responds
- raised the update check's npm registry timeout from 2.5s to 30s, so a slow connection no longer drops the notice
- repository lifecycle hooks (`onCreating` / `onCreate` / `onUpdating` / `onSaving` / `onDeleting` / …) now run on `create` / `update` / `delete` — they were defined but never invoked
- `repository.list()` / `all()` now honor the `sortBy`, `sortDirection`, and `purgeCache` options — previously accepted but silently ignored

### Removed

- presigned-upload `maxSize` option — a presigned PUT URL cannot enforce a size cap, so the option was a false guarantee

### Fixed

- `response.sendFile({ filename })` and `response.download()` no longer 500 on non-ASCII file names — the `Content-Disposition` header is now RFC 6266-encoded (a sanitized ASCII `filename` fallback plus an RFC 5987 `filename*=UTF-8''…`), so an Arabic / emoji / UTF-8 download name streams correctly instead of throwing Node's `ERR_INVALID_CHAR`
- local storage paths are contained to their disk root — `../` traversal segments and absolute paths can no longer escape the configured directory
- `storage.putFromUrl` adds SSRF guards — private / loopback / link-local hosts are rejected and the fetched body is size-capped
- S3 / R2 / DigitalOcean Spaces `url()` no longer produces a malformed double-host URL when `urlPrefix` is set
- cloud `deleteDirectory` paginates via the list continuation cursor instead of re-listing the first page
- local-storage metadata cache is invalidated on write / delete — it was serving a stale size / modified-time
- the cloud driver no longer reports a misleading "SDK not installed" error when the AWS SDK is in fact present (driver load race)
- repository `countCached` / `countActiveCached` now cache and return correctly — a `null` cache miss was being returned as the count
- repository `firstCached` / `lastCached` no longer fetch and cache the entire table to return a single row
- repository boolean filters no longer coerce `false` / `0` to `true`
- repository cache keys are now order-independent (stable key serialization)
- router groups restore prefix / name / middleware state via `try/finally` even when the group callback throws
- `router.any()` / `all` routes now match every HTTP verb under the dev server — they previously matched only GET and POST, diverging from production
- the HTTP concurrency limiter releases its slot on every response path (`noContent`, redirect, file, buffer) — a throwing or non-`send` handler no longer leaks a permit and permanently 429s the route
- the cached-response middleware replays a hit through `response.replay()` instead of re-sending an already-sent reply, preserving status and content-type
- `onSent` cache writes in the idempotency and cache middleware are error-handled — a cache-backend failure no longer surfaces as an unhandled rejection
- `X-Forwarded-For` is parsed to its first hop, so IP-filter / rate-limit / idempotency scoping cannot be spoofed with extra header hops
- the `maintenance` middleware allowlist matches request paths that carry a query string
- use-cases run their `after` middleware and broadcast for a `void` handler, and a failed history write no longer fails an otherwise-successful call
- the use-case retry counter reports the correct count on total failure
- the socket connector no longer double-closes the shared HTTP server during graceful shutdown
- the cache connector disconnects its drivers on shutdown — an open Redis connection was left dangling
- generator stubs import `v` / `Infer` from `@warlock.js/seal` (core never re-exported them), so generated models compile and run
- `warlock dev` hot-reloads when a file is emptied or saved with no trailing newline — a stale no-op-change check was silently dropping those saves before they reached HMR

## 4.4.0 - 2026-06-21

### Added

- `Application.onceBooted(cb)` — run a callback once the app is fully booted (fires immediately if already booted)
- `Application.whenBooted()` — promise that resolves with the boot context when the app is fully booted
- `Application.isBooted` — whether the app has finished booting
- `Application.onShutdown(cb)` — run teardown once on shutdown, before connectors stop (mirror of `onceBooted`)
- `Application.isShuttingDown` — whether shutdown has begun
- built-in `/health` (liveness) and `/ready` (readiness) endpoints with a `health` check registry (`health.addCheck`)
- graceful HTTP shutdown — drains in-flight requests on shutdown, bounded by `http.gracefulShutdown.timeout`
- `http.health.*` config to toggle or rename the health endpoints

### Fixed

- connector shutdown no longer reverses the connector list in place (could corrupt order on a repeated shutdown)

## 4.3.0 - 2026-06-21

### Added

- `warlock update` — update every `@warlock.js/*` package in package.json to its latest version (operator preserved), then run the detected package manager's install
- dev-server update notice — `warlock dev` checks npm on start and prints a one-line notice when a newer `@warlock.js/core` is published
- `devServer.checkForUpdates` config flag (default `true`) to toggle the dev-server update notice
- `fetchLatestVersion()` and `isNewerVersion()` registry/version utilities

### Fixed

- `warlock dev --skip-typings` and `--skip-health` long-form flags now work (were silently ignored)

## 4.2.11

### Added

- `lowerStage3Decorators()` — Vite/Vitest plugin that lowers TC39 Stage-3 decorators with esbuild before oxc / the SSR rewrite mangles them; drop it first in `plugins` so model-decorated files load under Vitest 4 / Vite 8.
- `warlock add notifications` — installs `@warlock.js/notifications` (+ the `mail` feature), ejects `config/notifications.ts`, and scaffolds the app-owned `Notification` model + migration (idempotent).
- Notifications connector — a built-in, config-gated connector that lazy-imports `@warlock.js/notifications`, so core keeps no hard dependency on it.

### Changed

- `warlock add test` now scaffolds a `vite.config.ts` that includes `lowerStage3Decorators()`, so a fresh project can test decorated models out of the box.
- `warlock add test` `test` / `test:coverage` scripts now run one-shot (`vitest run`) instead of watch mode — CI-safe by default.
- Bumped `@mongez/reinforcements` to 3.3.0

### Fixed

- `startHttpTestServer` now starts early-phase connectors (database, cache, logger, …) before app modules, then late-phase (http, socket) after — mirroring dev/prod boot order; fixes a `MissingDataSourceError` under the Vitest integration harness.

## 4.2.5

### Added

- `warlock add notifications` now scaffolds the in-app read/dismiss HTTP surface — `routes.ts` + a `notifications.controller.ts` (list / unread-count / mark-read / mark-all-read / clear / delete), gated by `authMiddleware` and recipient-scoped via `inApp`. Pulls `@warlock.js/auth`.

## 4.2.4

### Fixed

- Fix the worker-loader path in the build entry points — a wrong path in 4.2.3 left the worker entry broken (and blocked the 4.2.3 publish for some packages).

## 4.2.3

### Fixed

- Add the worker scripts as build entry points so they ship in the published package.

## 4.2.2

### Fixed

- Add `cli/start` to the build entry points so the `warlock` CLI entry ships in the published package.

## 4.2.1

### Fixed

- Ship the `bin` folder so the `warlock` CLI works from the published package — it was omitted from the 4.2.0 build.

## 4.2.0

### Changed

- `herald-connector` and `http-connector` now log a failed boot-time connection at `log.fatal` (was `log.error`) — an unrecoverable broker connection or HTTP port-bind failure makes "page on fatal only" alerting clean; the HTTP connector flushes logs before `process.exit(1)`. Disconnect / shutdown failures stay at `error`.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
