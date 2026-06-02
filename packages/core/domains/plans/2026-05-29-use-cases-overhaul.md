# 2026-05-29 — Use Cases overhaul

**Status:** completed (2026-05-29)
**Started:** 2026-05-29

## Summary

All phases shipped. `@warlock.js/core/src/retry` deleted; retry now from `@mongez/reinforcements` (`retry` option, handler-scoped, `currentRetry` tracked via `onError`). `benchmark?: boolean | BenchmarkOptions` forwarded to `measure`, handler-scoped. First-class `src/config/use-cases.ts` + `UseCaseConfigurations`. Schema→Input inference (overload) + `Ctx` generic + `description`; `benchmarkResult`/`schema!` drift fixed. `log`-gated logging observer + isolated `fireLifecycleEvent` dispatch; `console.error` → `log.error`. Broadcast: core `UseCaseBroadcastChannel`/`UseCaseBroadcastEvent` + `broadcastUseCaseResult` (success-only, `Promise.allSettled`, fault-isolated); herald `heraldBroadcast()` adapter (structural, no core dep). History list capped (`history.maxEntries`, default 100) + self-pruning; success-counter bug + dead `increaseUseCaseCalls` fixed (Phase 1). Skills (`write-use-case` rewrite, `retry-operation` redirect, herald `publish-message` broadcast section), core docs (the-basics + digging-deeper + recipes + lifecycle), READMEs, and `llms.txt`/`llms-full.txt` updated; stale `USE-CASES-DESIGN.md` removed. **Verified:** root `tsc --noEmit` 0 errors (incl. heraldBroadcast wired through aliases). Not committed.
**Context:**

- Design: [`../design/use-cases.md`](../design/use-cases.md) (Agreed)
- Decisions: [`../design/decisions.md`](../design/decisions.md) (2026-05-29 entry)
- Code: `@warlock.js/core/src/use-cases/`, `@warlock.js/core/src/benchmark/`, `@warlock.js/core/src/retry/` (to delete)
- Upstream dep: `@mongez/reinforcements` `retry` + `shouldRetry` — `D:/xampp/htdocs/mongez/node/@mongez/plans/retry-enhancements.md`
- Herald: `@warlock.js/herald/src/` (adapter), `@warlock.js/core/src/connectors/herald-connector.ts` (optional-import precedent)
- Config registry pattern: `@warlock.js/core/src/config/types.ts` (`ConfigRegistry`), `src/config/repository.ts` + `benchmark.ts` (file stubs)

## Why now

Senior review surfaced one stats-corrupting bug, two retry/benchmark design flaws, an unguarded observer dispatch (blocks safe broadcast), a ghost global config, and broad doc drift — and we're adding `broadcast` (herald) on top. Bundle the fixes with the new surface so consumers learn the correct shape once.

## Dependency ordering

1. **BLOCKING:** `@mongez/reinforcements` retry `shouldRetry` (retry-enhancements plan, Feature 1) ships first. Without it, use-cases lose selective retry.
2. Then the core work below.

## Phase 1 — bug fixes (ship independently, low blast radius) — DONE 2026-05-29

- [x] Move `increaseUseCaseSuccessCalls` into the success branch; failures must not bump `success`/double-bump `total`
- [x] Delete dead `increaseUseCaseCalls`
- [x] Cap the history `:list` (trim to last `MAX_HISTORY_ENTRIES` = 100) + drop expired ids on read

> Kept surface-free: history cap is a hardcoded const (configurable knob deferred to Phase 4), so no skill/doc lockstep needed for Phase 1. Added `resolveHistoryTtl` helper (dedupes TTL resolution between add/get) and `cache.remove` on eviction.

## Phase 2 — retry migration

- [ ] Delete `@warlock.js/core/src/retry/`
- [ ] Import `retry` + `RetryOptions` from `@mongez/reinforcements` in `use-case.ts` + `types.ts`
- [ ] Rename option `retryOptions` → `retry`; reshape `UseCaseResult.retries` (`attempts`/`delay`/`backoff`/`currentRetry`)
- [ ] Scope retry to the **handler only** (not the pipeline)
- [ ] Opt-in gating: only wrap when `retry` configured (avoid reinforcements' default `attempts: 3`)
- [ ] Track `currentRetry` via the util's `onError(error, attempt)`

## Phase 3 — benchmark

- [ ] Rename option to `benchmark?: boolean | BenchmarkOptions`, forward straight to `measure`
- [ ] `measure` wraps the **handler**, not the prelude or retry sleeps
- [ ] Document single config home (`use-cases.benchmark`); `benchmark.ts` reserved for standalone `measure`

## Phase 4 — global config first-class

- [ ] Generator stub `src/config/use-cases.ts`
- [ ] Export `UseCaseConfigurations`; register `"use-cases"` in `ConfigRegistry`
- [ ] Wire resolution: per-use-case ?? global ?? framework default

## Phase 5 — typing

- [ ] Schema→Input inference (`Input = Infer<typeof schema>` when schema present)
- [ ] `Ctx` generic threaded through guards/before/after/handler
- [ ] Fix `benchmarkResult` type/runtime mismatch, drop `schema!`, type registry without `as`
- [ ] Add `description` field

## Phase 6 — logging + observer hardening

- [ ] Isolate each observer in `fireLifecycleEvent` (try/catch) — one bad subscriber can't break/stall the pipeline
- [ ] Built-in logging observer via `globalUseCasesEvents`, gated by `use-cases.log`, through `@warlock.js/logger`
- [ ] Replace the stray `console.error` with `log`

## Phase 7 — broadcast

- [ ] Core: `UseCaseBroadcastChannel` interface + `UseCaseBroadcastEvent` type
- [ ] Per-use-case `broadcast?: boolean | { event?, output? }`
- [ ] Global `broadcast: { enabled, channels[] }`; resolution + global kill-switch
- [ ] Runtime: success-only, build envelope, project via `output`, fan out under `Promise.allSettled` + try/catch, no-op when disabled/disconnected
- [ ] Herald: `heraldBroadcast({ broker })` adapter (structural, no core import) exported from `@warlock.js/herald`

## Phase 8 — `@warlock.js/*` lockstep (REQUIRED, same delivery)

- [ ] Skills: rewrite `@warlock.js/core/write-use-case`; touch `benchmark-code`, `retry-operation` (retire/redirect to reinforcements); add broadcast section to `@warlock.js/herald/publish-message`
- [ ] Docs: `domains/core/docs/` guides + recipes (use-case pipeline, retry, benchmark, broadcast)
- [ ] Regenerate `domains/core/docs/llms.txt` + `llms-full.txt` (`node domains/core/scripts/generate-llms-txt.mjs`)
- [ ] Delete/replace `USE-CASES-DESIGN.md` drift; fix `use-cases/README.md` + `benchmark/README.md`

## Open questions

1. **`retry-operation` skill — retire or redirect?** Recommend redirect: keep a thin skill pointing to `@mongez/reinforcements` retry + the use-case `retry` option, so existing links don't 404. Tradeoff: one stub skill to maintain.
2. **History cap value (N)?** Recommend default 100 (matches `BenchmarkSnapshots`), config-overridable. Tradeoff: high-traffic use cases lose older history sooner.
3. **Ship Phase 1 separately first?** Recommend yes — the counter bug silently corrupts stats today and the fix is isolated. Tradeoff: two PRs instead of one.
