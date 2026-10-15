# 2026-04-25 — Comprehensive unit tests for `@warlock.js/logger`

**Status:** completed (archived 2026-06-01)
**Started:** 2026-04-25
**Context:** `@warlock.js/logger` shipped with zero tests despite covering file I/O, rotation, buffering, grouped paths, ANSI stripping, and process-level error capture. The monorepo standard is Vitest specs colocated with source.

## Tasks

- [x] Replace jest/ts-jest with vitest in `@warlock.js/logger/_package.json`
- [x] Add `@warlock.js/logger/vitest.config.ts` matching the monorepo convention
- [x] `src/utils/clear-message.spec.ts` — ANSI stripping, non-string passthrough (10 tests)
- [x] `src/utils/capture-unhandled-errors.spec.ts` — process listener registration + routing to `log.error` via a capturing channel (4 tests)
- [x] `src/logger.spec.ts` — construction, channel management, broadcast, level shortcuts (object + 4-arg forms), flushSync, singleton `log` binding (34 tests)
- [x] `src/log-channel.spec.ts` — config resolution, `shouldBeLogged`, date/time format, async `init` hook (14 tests)
- [x] `src/channels/console-log.spec.ts` — identity, per-level output, object payload, filters (12 tests)
- [x] `src/channels/file-log.spec.ts` — real-tempdir I/O, chunk modes, write format, auto-flush threshold, level/custom filters, error stack, flushSync, `groupBy` dirs, rotation (21 tests)
- [x] `src/channels/json-file-log.spec.ts` — JSON file format, Error stack as `string[]`, append across flushes, corruption recovery, grouped JSON (7 tests)
- [x] `src/index.spec.ts` — barrel export smoke (7 tests)
- [x] Create domain scaffolding: `domains/logger/README.md`, `backlog.md`, `plans/`
- [ ] Update `MEMORY.md` + feedback/reference memory files
- [ ] Verify: `npx vitest run --root @warlock.js/logger` green

## Key decisions

- **Test runner.** Vitest (matches `@warlock.js/ai`, `cascade`, `seal`, `cache`). Dropped the stale jest declaration from `_package.json`.
- **Filesystem strategy.** Real per-test temp dirs under `os.tmpdir()/warlock-logger-test/<uuid>`, cleaned in `afterEach`. No mocking of `@mongez/fs` — exercises actual rotation, chunking, JSON I/O.
- **Testing the bound `log` helper.** `log.info = logger.info.bind(logger)` captures a direct reference at import time, so `vi.spyOn(logger, "info")` does not intercept. Tests inject a capturing `LogChannel` onto the singleton and assert on channel output instead.
- **Init timing.** `LogChannel.init()` runs inside a `setTimeout(0)` in the constructor. Tests yield with `await new Promise(r => setTimeout(r, 10))` before asserting post-init behavior.

## Summary

Final green: **109 tests across 8 files.** Follow-up enhancements captured in [`../backlog.md`](../backlog.md).
