# 2026-04-25 — Phase B: Context revolution

**Status:** not-started
**Started:** —
**Context:** [backlog](../backlog.md#phase-b--context-revolution) · the differentiator. Built on [`@warlock.js/context`](../../../@warlock.js/context/src/index.ts) so we don't reinvent `AsyncLocalStorage`.

## Goal

Per-request context that flows automatically across every async boundary. Eliminates manual `requestId` threading.

## Tasks

### B1 — Child loggers

- [ ] `Logger.child(context: Record<string, any>): ChildLogger`
- [ ] `ChildLogger` exposes the same surface as `Logger` (`info`, `debug`, etc.) but auto-merges the bound context into every entry
- [ ] Child loggers can be re-childed: `requestLog.child({ orderId })`
- [ ] Bound context is shallow-merged with caller-supplied `context`; caller wins on conflict
- [ ] Tests — context flows through level methods + the bare `log()` callable

### B2 — AsyncLocalStorage propagation via `@warlock.js/context`

- [ ] Create `LoggerContext extends Context<Record<string, any>>` (inside the logger package)
- [ ] Export `loggerContext` singleton + `log.runWithContext(store, fn)` shortcut
- [ ] `Logger.log` reads `loggerContext.getStore()` and merges into `data.context` (caller-supplied wins)
- [ ] Add `loggerContext` to `contextManager` registration in the bridge package (Phase B3)
- [ ] Tests — verify context survives `await`, `setTimeout`, third-party libraries

### B3 — Cascade bridge package: `@warlock.js/logger-cascade`

New package, scaffolded same as `@warlock.js/ai-openai`.

- [ ] Package skeleton (`_package.json`, `tsconfig`, `vitest.config.ts`)
- [ ] `auto.ts` side-effect entry: reads `warlock.config.ts` logger section, calls `logger.configure({ channels, autoFlushOn })`, calls `captureAnyUnhandledRejection()`, registers Cascade middleware that creates a child logger per request
- [ ] Cascade lifecycle integration: hook `cascade.onShutdown` to `flushAsync()`
- [ ] Skill files for the bridge package (its own `skills/`)
- [ ] Tests against a mock Cascade app

### B4 — `flushAsync()`

- [ ] Add `flushAsync?(): Promise<void>` to `LogContract` (optional, mirroring `flushSync`)
- [ ] `Logger.flushAsync()` — `Promise.all(channels.map(c => c.flushAsync?.()))`
- [ ] Implement on `FileLog` / `JSONFileLog` (write current buffer via async file ops)
- [ ] Bind on `log` helper: `log.flushAsync = logger.flushAsync.bind(logger)`
- [ ] Tests — async flush behaves the same as sync flush in steady state

## Verification

- Existing tests still pass
- New test target: +30 across B1–B4
- E2E smoke: a Cascade app with the bridge package — single request triggers logs across 3 modules; verify every line carries `requestId` automatically

## Critical files

- `@warlock.js/logger/src/logger.ts` (`child`, `runWithContext`, `flushAsync`, context merge in `log()`)
- `@warlock.js/logger/src/child-logger.ts` (new)
- `@warlock.js/logger/src/logger-context.ts` (new — `Context<Record<string, any>>` subclass)
- `@warlock.js/logger/src/types.ts` (extend `LogContract` with `flushAsync?`, add `Log.child`)
- `@warlock.js/logger-cascade/` (new package, full skeleton)
- `domains/logger/skills/subskills/context.md` (new)
- `domains/logger/skills/subskills/child-loggers.md` (new)

## Estimate

~2 weeks (1 week core + 1 week bridge package).

## Open questions

- **Q1.** Should `child()` accept a function so context can be lazy? **Recommendation:** start with plain object; add lazy form if a real use-case appears.
- **Q2.** When ambient context (B2) and explicit child context (B1) and call-site context all exist, what's the merge order? **Recommendation:** ambient → child → call-site (most specific wins). Document in skill.
- **Q3.** Should the bridge package be `@warlock.js/logger-cascade` or live under `@warlock.js/cascade-logger`? **Recommendation:** `logger-cascade` — keeps the logger ecosystem grouped under `logger-*` prefix, matches `cache-cascade`-style naming if/when those exist.
