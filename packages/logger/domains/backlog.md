# logger — backlog

Roadmap for `@warlock.js/logger`. Items are grouped into shipping phases. Each phase has a corresponding plan under [`plans/`](./plans/).

---

## Shipped

- ✅ **Excellence pass** (2026-06-01):
  - **mongez deps to latest** — `@mongez/copper` `^1.0.1 → ^2.1.2` (major; `colors` API verified compatible across logger + cascade + auth consumers), `@mongez/reinforcements` `^3.1.16 → ^3.2.0`; root install + lockfile updated.
  - **Bug — `safeJsonStringify` error fields dropped.** `errorReplacer` returned `{ ...error }`, which captures only enumerable props — `name`/`message`/`stack` are non-enumerable, so serialized errors (incl. errors nested in `context`) became `{}`. Now copies the three explicitly + spreads custom enumerable props. Code finally matches the skill/doc claim.
  - **Cleanup — stray `console.log` removed.** `captureAnyUnhandledRejection` dumped the raw promise/error to stdout (bypassing channels); `FileLog.checkAndRotateFile` logged on every ENOENT. Both removed so the logger never writes outside its own channels.
  - **Dead code removed** — unused `JSONFileLog.initialFileContents` getter.
  - **Tests 163 → 184**, coverage 79.7% → **93% stmts / 94.6% lines**: new `safe-json-stringify.spec.ts` (error-field regression), async buffer-write paths for `FileLog`/`JSONFileLog`, `dispose()`, disk-write-failure fallbacks, context retention.
  - **Standalone test config fix** — `vitest.config.ts` now aliases `@warlock.js/fs` to its sibling source so the file-channel specs run without the root tsconfig paths.
  - **Docs/skills lockstep** — landing-page API examples rewritten; `capture-unhandled-errors` skill + Starlight page de-stale'd (`console.log` claim); utilities reference clarified; llms regenerated.
- ✅ **Vitest unit suite** — 117 tests across 8 files (2026-04-25)
- ✅ **Auto-flush on shutdown** — `Logger.enableAutoFlush(events)` + `configure({ autoFlushOn })` (2026-04-25)
- ✅ **Logger.log mutation fix** — shallow-clone per non-terminal channel before ANSI strip (2026-04-25)
- ✅ **JSONFileLog `isInitialized` guard** — write path now matches FileLog (2026-04-25)
- ✅ **Docs accuracy sweep** — fixed ~17 contradictions across docs + package README (2026-04-25)
- ✅ **Domain scaffolding + assistant skill files** — `skills/SKILL.md` + 7 subskills (2026-04-25)
- ✅ **Polish day quick wins** (2026-04-25):
  - `ConsoleLog({ showContext, contextDepth })` — opt-in second-line context render
  - `Logger.setMinLevel(level)` + `configure({ minLevel })` — fast-path severity floor (Phase D4)
  - `log.assert(condition, module, action, message, context?)` — implicit-error assertion (Phase E3)
  - `log.timer(module, action)` — duration helper, returns `end(extra?)` (Phase E2)
  - +19 tests (117 → 136)
- ✅ **API rename — `logger` → `log` singleton** (2026-04-25, **breaking**):
  - Collapsed dual `logger` (singleton) + `log` (callable shorthand) exports into a single `log` instance.
  - Deleted the `Log` interface — `Logger` class is now the canonical type.
  - Fixed pre-existing class signature inconsistency: `debug/warn/error/success` now accept `OmittedLoggingData | string` like `info` did.
  - Migration: `s/\blogger\b/log/g` for monorepo consumers (also touched `@warlock.js/core`, `cascade`, `auth`, `ai`, `herald`, plus app `src/`).
  - Tests: 170 → 163 (–7 redundant proxy tests, +2 sanity checks).
  - Documentation lockstep: every `skills/` file + every `domains/logger/docs/*.mdx` page updated in the same arc.
- ✅ **Phase A2 — Redaction** (2026-04-25):
  - `Logger.setRedact(config)` + `configure({ redact })` — logger-wide floor
  - Per-channel `redact` config — additive on top of the floor (channels can never undo)
  - Glob path matcher: literal segments, `*` (one segment), `**` (any depth)
  - String or function censors; function receives `(value, path)`
  - Deep clone with `Date`/`Error` fidelity + circular-ref tolerance
  - +34 tests (136 → 170)

---

## Phase A — Production credibility

Plan: [`plans/2026-04-25-phase-a-production-credibility.md`](./plans/2026-04-25-phase-a-production-credibility.md)

Goal: graduate from dev-only to running in real deployments.

- **A1 — Pluggable buffer store.** Extract `BufferStore` interface; implementations: `InMemoryBufferStore` (default), `LRUBufferStore` (bounded — drops oldest), `CacheBackedBufferStore` (wraps any `@warlock.js/cache` driver). Unifies bounded buffer + drop policy + cross-restart durability into one abstraction.
- **A2 — Redaction.** `redact: { paths: ["password", "*.token"], censor: "[REDACTED]" }` applied before write. Glob-style path matching; per-channel or logger-wide.
- **A3 — Pino-stream compatibility shim.** `PinoCompatChannel` accepting the pino transport `write(line)` interface. Unlocks the entire pino ecosystem (pino-elasticsearch, pino-syslog, pino-mongodb, pino-tee).
- **A4 — Sampling decorator on BufferStore.** `SamplingBufferStore` wrapping any base store; per-level rates. Falls out for free once A1 ships.
- **A5 — Self-observability metrics.** `logger.metrics()` returns `{ logged, dropped, bytesWritten, rotations, flushes, errorsInChannel }`. Pairs with A1's drop counters.

---

## Phase B — Context revolution

Plan: [`plans/2026-04-25-phase-b-context-revolution.md`](./plans/2026-04-25-phase-b-context-revolution.md)

Goal: make per-request logging effortless across async boundaries. Built on `@warlock.js/context`.

- **B1 — Child loggers.** `log.child({ requestId, userId })` returns a sub-logger that auto-attaches context to every call.
- **B2 — AsyncLocalStorage propagation.** `loggerContext.run({ ... }, () => ...)` via `@warlock.js/context`'s `Context` base. Every nested log call inherits ambient context.
- **B3 — Cascade bridge package.** `@warlock.js/logger-cascade` — auto-wires channels from `warlock.config.ts`, installs `autoFlushOn` into Cascade's shutdown lifecycle, injects request-scoped child logger into the request context.
- **B4 — `flushAsync()` companion.** Async counterpart to `flushSync()` for graceful-shutdown paths that can `await`.

---

## Phase C — Integrations sprint

Plan: [`plans/2026-04-25-phase-c-integrations-sprint.md`](./plans/2026-04-25-phase-c-integrations-sprint.md)

Goal: ship the integrations package that turns the logger from "internal tool" to "production choice." Single package — `@warlock.js/logger-adapters` — with lazy-loaded peer SDKs (cascade-style). Each adapter ~50–100 LOC.

### Messaging / alerting

- **C1 — `SlackChannel`** (peer: webhook URL, optional `@slack/web-api`)
- **C2 — `DiscordChannel`** (peer: `discord.js` or webhook URL only)
- **C3 — `TelegramChannel`** (peer: Bot API via `node-telegram-bot-api` or fetch)
- **C4 — `EmailChannel`** (peer: `nodemailer` or AWS SES) — for digest emails
- **C5 — `GenericWebhookChannel`** (no peer — pure fetch + templating)
- **C6 — `PagerDutyChannel`** (peer: `node-pagerduty` or fetch on Events API)

### Error tracking

- **C7 — `SentryChannel`** (peer: `@sentry/node`) — error logs become Sentry events with stack + breadcrumbs

### Log aggregators

- **C8 — `LokiChannel`** (peer: HTTP only) — Grafana Loki push API
- **C9 — `DatadogChannel`** (peer: HTTP only) — Datadog Logs API
- **C10 — `ElasticsearchChannel`** (peer: `@elastic/elasticsearch`)
- **C11 — `CloudWatchChannel`** (peer: `@aws-sdk/client-cloudwatch-logs`)
- **C12 — `BetterStackChannel`** (peer: HTTP only)
- **C13 — `AxiomChannel`** (peer: HTTP only)

### Cross-cutting (shared utilities)

- **C14 — Batching helper.** `BatchingChannelMixin` — collect entries, send every N or every M ms, gzip. Required for all HTTP-based adapters.
- **C15 — Retry / circuit-breaker helper.** Shared utility for transient failures (5xx, 429, timeouts).

---

## Phase D — Platform maturity

Plan: [`plans/2026-04-25-phase-d-platform-maturity.md`](./plans/2026-04-25-phase-d-platform-maturity.md)

Goal: become the "boring, reliable" choice. Polish the platform.

- **D1 — Pluggable formatters.** `Formatter` interface; built-ins: `defaultFormatter`, `ecsFormatter` (Elastic Common Schema), `pinoCompatFormatter`, `logfmtFormatter`. `FileLog` and `JSONFileLog` accept a `formatter` option.
- **D2 — Custom levels with TS augmentation.** `defineLevel("audit", { rank: 25, color: "cyan" })` runtime + documented `declare module` augmentation pattern for autocomplete.
- **D3 — OpenTelemetry bridge.** `OtelChannel` emitting OTel `LogRecord`. Auto-correlates with active OTel trace.
- **D4 — Logger-wide minimum level.** `logger.setMinLevel("info")` — drops levels below this on every channel without per-channel config.
- **D5 — Deduplication / coalescing.** `dedupe: { window: "5m", key: ["module", "action", "message"] }` — collapses identical errors within a window into a single line + counter.
- **D6 — Hot-reload of configuration.** SIGHUP (or watched config file) triggers re-read without restart.

---

## Phase E — DX polish

Plan: [`plans/2026-04-25-phase-e-dx-polish.md`](./plans/2026-04-25-phase-e-dx-polish.md)

Goal: small features that make people tweet about the package.

- **E1 — Pretty-print dev mode.** `ConsoleLog({ pretty: true })` with file:line resolution (matches pino-pretty).
- **E2 — `log.timer()`.** `const end = log.timer("db", "query"); ... end()` — auto-logs duration.
- **E3 — `log.assert()`.** `log.assert(cond, module, action, message)` — logs at error level when `cond` is falsy, no-op otherwise.
- **E4 — `log.when(cond)`.** Conditional logging — returns no-op proxy when condition is false; useful for expensive context-builders.
- **E5 — Crash-dump rescue file.** On uncaught exception, dump the last N entries from every buffer to `./logs/crash-dump-<ts>.json` so context survives even if the remote sink is unreachable.
- **E6 — Environment presets.** `presets.production({ storagePath })`, `presets.development()`, `presets.test()` — opinionated defaults so day-one is one line.
- **E7 — Log signing / tamper-evidence.** Each entry hashed with the previous entry's hash → tamper-detectable chain. Niche but unique selling point in fintech / health.

---

## Phase F — Ecosystem

Plan: [`plans/2026-04-25-phase-f-ecosystem.md`](./plans/2026-04-25-phase-f-ecosystem.md)

Goal: long-tail features and platform extensions.

- **F1 — Replay / ingest CLI.** `npx @warlock.js/logger replay ./logs/**/*.json --level error --since "1h ago"`.
- **F2 — Structured query API.** `log.query({ since, level, module })` for `JSONFileLog` files — read back what the package wrote without `jq`.
- **F3 — `FdChannel`.** Write to any file descriptor (stdout fd 1, stderr fd 2, Kubernetes sidecar fd 3, Unix socket, named pipe).
- **F4 — Express / Fastify middleware bridges** — separate small packages that create a request-scoped child logger and attach it to the request context.
- **F5 — Prometheus metrics adapter.** Exposes `logger.metrics()` (D-something) via a `/metrics` endpoint.
- **F6 — More adapters added to `logger-adapters` over time** — Discord webhooks, Mattermost, MS Teams, Splunk HEC, etc.

---

## Recommended next (2026-06-01 review)

Fresh recommendations from the excellence pass, ordered by leverage. Items overlapping an existing phase are cross-referenced rather than duplicated.

- **G1 — `Logger.disposeAll()` / lifecycle teardown.** `FileLog.dispose()` exists per channel, but the `log` singleton has no way to stop every channel's 5s flush interval at once. Reconfiguring the logger at runtime (`setChannels`) silently leaks one timer per discarded `FileLog`. Add `log.disposeAll()` that disposes each channel exposing `dispose()`. **High leverage, small surface.**
- **G2 — Rotation retention / cleanup.** `rotateLogFile()` renames the active file aside on size overflow but nothing ever deletes the rotated files — disk grows unbounded in long-lived processes. Add `maxFiles` / `maxAge` retention (prune oldest on rotate). Cost/ops risk; pairs with the size+count rotation already in housekeeping. **Recommended before any "production credibility" claim.**
- **G3 — Ship a reusable test channel (`MemoryLog`).** Every consumer hand-rolls a capturing `LogChannel` subclass (see the `test-logging-code` skill). Export a small `MemoryLog` (buffers `received: LoggingData[]`, `terminal: false`) so tests are one import, not boilerplate. Mirrors `MockSDK`/`MockCacheDriver` in sibling packages. **DX win.**
- **G4 — Resolve `JSONFileLog.extension` dead option.** `extension` is silently ignored (hardcoded `"json"`). Either drop it from `FileLogConfig` for the JSON channel's type, or emit a one-shot warn. **Type honesty.**
- **G5 — `Logger.log` fast path.** Single-channel + no logger-wide redact is the common case; skip the per-channel clone/merge loop. Micro-opt, measure first. (Adjacent to Phase A perf goals.)
- **Chore — fix `_package.json` `repository.url`** — still points at `github.com/hassanzohdy/mongez-password` (copy-paste leftover), not the logger repo.

## Release-prep review (2026-06-01)

Findings from the release-quality pass (skills/tests/docs). Fixed items are marked ✅; the rest are deferred (no behavior change made to pass a test, per policy).

- ✅ **Skill drift — `test-logging-code` "Gotcha" was fabricated.** The skill claimed `log.info` is bound at import time (`log.info = log.info.bind(logger) as Log["info"]`) and that `vi.spyOn` can't intercept it — referencing the deleted `Log` interface. False against current src: `log` is a plain `Logger` instance, methods live on the prototype, `vi.spyOn(log, "info")` works. Rewrote the section to recommend the capturing channel for the *right* reasons (asserts delivered entries through the pipeline, isolates the shared singleton). Same stale claim scrubbed from `overview/SKILL.md` prose + `test-logging-code` frontmatter description.
- ✅ **Doc/skill type bug — custom-channel configs didn't extend `BasicLogConfigurations`.** `LogChannel<Options>` constrains `Options extends BasicLogConfigurations`, but the `SlackLog` / `DatabaseLog` / `BatchHttpLog` examples declared bare configs (`{ webhookUrl }`, `{ connectionString }`, `{ url }`) — a real `tsc` error, and `levels`/`filter`/`redact` wouldn't be typed. Fixed in `channels/05-custom.md`, `write-custom-log-channel/SKILL.md`, and the new Slack recipe to `BasicLogConfigurations & { ... }`. (Constraint confirmed via isolated `@ts-expect-error` check.)
- ✅ **Tests 184 → 189.** Added: redact `**`-through-arrays + literal numeric array-index path (`context.tokens.1.value`) incl. out-of-bounds; `ConsoleLog` unknown-level `default` switch branch; `Logger` level-shortcut-overrides-object-`type` contract. Branch coverage 86.2% → 89.4%; `redact.ts` funcs 87.5% → 100%; `console-log.ts` → 100%.
- ✅ **Docs — recipes added.** New `docs .../logger/recipes/` (rotating file in prod, request/trace context, ship errors to Slack, silence noisy logs per env) + a copy-pasteable dive-in block atop the getting-started entry. **Nav not wired** (per scope — `astro.config.mjs` untouched): a follow-up must add an `autogenerate: { directory: "v/latest/logger/recipes" }` group to the logger sidebar so they surface (mirror the cache "Recipes" group). Until then they are reachable only via in-page cross-links.
- **Dead code — `LogChannel.withBasicConfigurations`** (`log-channel.ts:140-145`) is never called anywhere in src. Remove it, or wire it into channel construction if it was meant to seed `filter: () => true` defaults. (Not tested — dead code.)
- **JSDoc inconsistency in `types.ts`** — `RedactConfig` / `RedactCensor` `@example` blocks call `logger.configure(...)` / `logger.setRedact(...)`; the singleton is `log` (the `logger` export was collapsed). Harmless (comments only) but reads stale next to `log`-based docs everywhere else. Tidy the examples to `log.*`.
- **`JSONFileLog` grouped write-failure + grouped-flushSync-corruption paths uncovered** (`json-file-log.ts` ~157-173). Non-grouped equivalents are tested; grouped error branches are low-value and contrived to trigger — left as a known coverage gap rather than adding brittle mocks.
- **Flaky file-channel tests (pre-existing, timing-based).** `npx vitest run` is green on the large majority of runs (189/189), but the real-temp-dir file tests occasionally fail (~1 in 10+ runs observed, 2 tests) because they assert after fixed `setTimeout` waits (e.g. `file-log.spec.ts` rotation asserts on `fs.readdirSync` after a 250 ms sleep; the async-buffer-write specs poll with `waitForFile`). On a busy/slow Windows FS the write can land after the assertion. Not a product bug — the channels work; the tests race. Harden by polling for the post-condition (extend `waitForFile`/`waitForCondition` to cover the rotation + write-failure assertions) instead of sleeping a fixed interval. The 5 tests added in this pass are deterministic (pure redact + sync console + a single awaited log) and are not implicated.
- **Gotcha worth surfacing in docs — `chunk: "daily"`/`"hourly"` ignores `name`.** `FileLog.fileName` returns the formatted date for daily/hourly chunks (`file-log.ts:229-241`), so two daily channels in the same `storagePath` silently write to the same file, and a `name: "errors"` reads as if it produced `errors.log` when it doesn't. The new recipes call this out and route the errors file to its own `storagePath`; the pre-existing single-FileLog examples in `filter-log-entries/SKILL.md` and `channels/01-overview.md` still pair `name: "errors"` with `chunk: "daily"` (harmless — one file channel — but the inert `name` reads misleadingly). Consider either documenting the interaction on the File Channel page or making `name` participate in the daily/hourly filename (e.g. `errors-15-03-2024.log`). **Behavior-change candidate — not made.**

## Recently captured during review (housekeeping)

- **Move `process.cwd()` default out of class-body evaluation** — read at instance time means `cd` between construction and first write changes log location.
- **TODO in `file-log.ts`:** "Add max messages per file before rotation" — message-count-based rotation in addition to size-based.
- **Promote architectural notes into `domains/logger/design/`** once a design decision needs to be recorded (buffering model, rotation spec, channel contract).
- ✅ **5-second flush interval is now clearable** (resolved) — `initMessageFlush` stores `flushIntervalHandle`; `FileLog.dispose()` clears it and drains the buffer. Remaining gap tracked as **G1** (a logger-wide `disposeAll()` to fan this out across all channels).

---

## Architectural decisions captured during planning

- **Integrations package:** single `@warlock.js/logger-adapters` with lazy-loaded peer SDKs (mirrors `@warlock.js/cascade` driver pattern). Split by concern only if it grows past ~15 adapters.
- **Buffer abstraction:** unify bounded buffer / drop policy / persistence under one `BufferStore` interface (Phase A1).
- **Context layer:** built on `@warlock.js/context`, not raw `AsyncLocalStorage` — keeps Warlock packages composable.
- **Custom levels:** require both runtime registration **and** documented TS augmentation pattern. Skill doc must teach both halves.
- **Assertions:** implicit `error` level (matches pino's stance). Sub-API like `log.assert.warn(...)` only added if real users ask.
