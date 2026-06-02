# 2026-04-25 — Phase E: DX polish

**Status:** not-started
**Started:** —
**Context:** [backlog](../backlog.md#phase-e--dx-polish) · the small features that make people tweet about the package.

## Goal

Make day-to-day usage delightful. Every item here is small individually; together they're what tips a developer from "it's fine" to "I love this logger."

## Tasks

### E1 — Pretty-print dev mode

- [ ] `ConsoleLog({ pretty: true })` — opt-in
- [ ] Resolves caller file:line from `Error().stack` (skip the logger frames)
- [ ] Renders objects with `util.inspect({ colors: true, depth: 4 })` (terminal channel keeps colors)
- [ ] Pretty timestamps (`10:22:01.482`) instead of full ISO when `pretty: true`
- [ ] Tests — file:line resolution, object rendering

### E2 — `log.timer()` ✅ (core shipped 2026-04-25)

- [x] `const end = log.timer(module, action)` returns a function
- [x] Calling `end()` emits `info` at `{ module, action, message: "completed in <ms>ms", context: { durationMs } }`
- [x] `end({ extra: "context" })` merges extra context
- [ ] Decorator form: `@log.timed("db", "query")` for class methods
- [x] Tests — duration accuracy, end()-twice independence

### E3 — `log.assert()` ✅ (core shipped 2026-04-25)

- [x] `log.assert(condition, module, action, message, context?)` — logs `error` when condition is falsy; no-op otherwise
- [ ] `log.assert(condition, dataObject)` — object form
- [x] Tests — falsy-value coverage, assert that truthy is genuinely free (no log call made)

### E4 — `log.when(cond)`

- [ ] `log.when(cond)` returns a no-op proxy when `cond` is false; the real `log` shorthand when true
- [ ] Critical: when cond is false, `log.when(cond).debug(buildExpensiveContext())` STILL evaluates `buildExpensiveContext()` (JS argument eval rules) — so document a thunk variant: `log.when(cond, () => log.debug(...))`
- [ ] Tests — proxy passthrough, no-op shape, thunk form

### E5 — Crash-dump rescue file

- [ ] On `uncaughtException` / `unhandledRejection`, dump the last N entries from every buffered channel to `<storagePath>/crash-dump-<ISO>.json`
- [ ] N is configurable: `Logger.configure({ crashDump: { lastN: 100, path: "./logs" } })`
- [ ] Synchronous write — must complete before Node tears down
- [ ] Tests — emit a fake unhandled rejection, confirm dump file exists with the prior N entries

### E6 — Environment presets

- [ ] `presets.development()` → `{ channels: [new ConsoleLog({ pretty: true })] }`
- [ ] `presets.test()` → `{ channels: [] }`
- [ ] `presets.production({ storagePath, lokiUrl?, sentryDsn? })` → opinionated combo: ConsoleLog (errors only) + JSONFileLog (daily, rotated) + optional Loki + optional Sentry
- [ ] `logger.configure(presets.production({ storagePath: "./logs" }))` works
- [ ] Tests — each preset produces the expected channel list

### E7 — Log signing / tamper-evidence

- [ ] `Logger.configure({ sign: { secret, algorithm: "sha256" } })`
- [ ] Each `LogMessage` gets a `signature` field — HMAC of `previousSignature + currentEntry`
- [ ] First entry chains from a known seed
- [ ] Verifier utility: `verifyLogChain(messages: LogMessage[], secret): { valid: boolean; brokenAt?: number }`
- [ ] Tests — happy path verification, tampered entry detected, missing entry detected

## Verification

- Existing tests pass
- New test target: +40 across E1–E7
- DX smoke: spin up a sample app, confirm pretty mode looks sharp in a terminal screenshot (manual)

## Critical files

- `@warlock.js/logger/src/channels/console-log.ts` (extend with `pretty`)
- `@warlock.js/logger/src/timer.ts` (new)
- `@warlock.js/logger/src/assertion.ts` (new)
- `@warlock.js/logger/src/conditional.ts` (new)
- `@warlock.js/logger/src/crash-dump.ts` (new)
- `@warlock.js/logger/src/presets.ts` (new)
- `@warlock.js/logger/src/sign.ts` (new)
- `@warlock.js/logger/src/types.ts` (extend `LogMessage` with `signature?`)
- `domains/logger/skills/subskills/timer.md` (new)
- `domains/logger/skills/subskills/presets.md` (new)
- `domains/logger/skills/subskills/sign.md` (new)

## Estimate

~1 week. Items are small and parallelizable.

## Open questions

- **Q1.** `log.assert` — sub-API for non-error levels (`log.assert.warn(cond, ...)`)? **Recommendation:** ship the implicit-error form first; add the sub-API only on demand.
- **Q2.** `log.when(cond)` arg-eval problem — should we ship only the thunk form to avoid the eval-trap? **Recommendation:** ship both, document the trap loudly in the skill doc.
- **Q3.** Sign chain — what happens when the file rotates? Restart the chain or chain across files? **Recommendation:** chain across files using a per-channel "last-signature" store on disk; keeps the audit trail unbroken across rotations.
