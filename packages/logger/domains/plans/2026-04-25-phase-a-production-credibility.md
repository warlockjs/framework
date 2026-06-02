# 2026-04-25 — Phase A: Production credibility

**Status:** in-progress (A2 shipped 2026-04-25)
**Started:** 2026-04-25
**Context:** [backlog](../backlog.md#phase-a--production-credibility) · the gap items between "internal dev tool" and "real production deployment." Without these, teams reach for pino instead.

## Goal

Buffer that survives load, redaction for compliance, and the pino ecosystem unlocked via a compatibility shim.

## Tasks

### A1 — Pluggable buffer store

- [ ] Define `BufferStore` interface (`push`, `drain`, `size`, optional `flushSync`)
- [ ] Implement `InMemoryBufferStore` — current behavior, becomes the default
- [ ] Implement `LRUBufferStore({ capacity })` — bounded; drops oldest naturally
- [ ] Implement `CacheBackedBufferStore(driver)` — wraps any `@warlock.js/cache` driver (gives Redis / file / LRU buffers for free)
- [ ] Refactor `FileLog` to use `bufferStore` option (default `new InMemoryBufferStore()`)
- [ ] Refactor `JSONFileLog` to inherit the same option
- [ ] Drop counter exposed via `bufferStore.metrics()`
- [ ] Tests — at minimum: each store implementation independently + integration with FileLog

### A2 — Redaction ✅ (shipped 2026-04-25)

- [x] Add `redact?: { paths: string[]; censor?: string | ((value, path) => any) }` to `BasicLogConfigurations`
- [x] Glob-style path matcher — `*` (single segment) and `**` (any depth) supported
- [x] Apply in `Logger.log` before fan-out (so every channel sees redacted version)
- [x] Per-channel `redact` extends (additive) the logger-wide config — channels can never undo a logger-wide redaction
- [x] Tests — common patterns + nested paths + arrays + Date/Error preservation + circular refs (+34 tests)
- Decision recorded: **additive only**. Rationale captured in [`subskills/redaction.md`](../../../../@warlock.js/logger/skills/subskills/redaction.md).

### A3 — Pino-stream compatibility shim

- [ ] `PinoCompatChannel({ stream })` — accepts any `{ write(line: string): void }`
- [ ] Adapter formats `LoggingData` into pino-flavored JSON (`{ level: 30, time, msg, module, action, ... }`)
- [ ] Documented level-numeric mapping (debug=20, info=30, warn=40, error=50, success=35)
- [ ] Skill subdoc: `subskills/pino-compat.md` walking through `pino-elasticsearch` setup
- [ ] Tests — feed a known pino transport and assert the shape it receives

### A4 — Sampling decorator

- [ ] `SamplingBufferStore(base, rates)` — wraps any base store; per-level rates (`{ debug: 0.01 }`)
- [ ] Random sampling via `Math.random()`; deterministic seed option for tests
- [ ] Counts dropped entries → exposed via metrics (A5)
- [ ] Tests — distribution check (rough), zero rate drops everything, undefined keeps all

### A5 — Self-observability metrics

- [ ] Per-instance counters: `logged`, `dropped`, `bytesWritten`, `rotations`, `flushes`, `errorsInChannel`
- [ ] `logger.metrics()` returns merged counters from every channel
- [ ] Channel-level: `channel.metrics()` (optional method on `LogContract`)
- [ ] Tests — increment correctness across each operation

## Verification

- All existing 117 tests still pass
- New test count target: +60–80 across A1–A5
- Manual smoke: configure `FileLog({ bufferStore: new LRUBufferStore({ capacity: 100 }) })`, log 1000 entries, confirm buffer size never exceeds 100 and `metrics().dropped === 900`

## Critical files

- `@warlock.js/logger/src/buffer/buffer-store.contract.ts` (new)
- `@warlock.js/logger/src/buffer/in-memory-buffer-store.ts` (new)
- `@warlock.js/logger/src/buffer/lru-buffer-store.ts` (new)
- `@warlock.js/logger/src/buffer/cache-backed-buffer-store.ts` (new)
- `@warlock.js/logger/src/buffer/sampling-buffer-store.ts` (new)
- `@warlock.js/logger/src/redact.ts` (new)
- `@warlock.js/logger/src/channels/file-log.ts` (refactor: use `bufferStore`)
- `@warlock.js/logger/src/channels/json-file-log.ts` (refactor: inherit)
- `@warlock.js/logger/src/channels/pino-compat-channel.ts` (new)
- `@warlock.js/logger/src/logger.ts` (apply redact before fan-out, add `metrics()`)
- `@warlock.js/logger/src/types.ts` (extend `BasicLogConfigurations` with `redact`)
- `domains/logger/skills/subskills/buffer-stores.md` (new)
- `domains/logger/skills/subskills/redaction.md` (new)
- `domains/logger/skills/subskills/pino-compat.md` (new)

## Estimate

~2 weeks single-developer.

## Open questions

- **Q1.** Should redaction's path matcher reuse `@mongez/reinforcements` (if it has glob), or vendor a tiny one?
- **Q2.** `BufferStore` — sync `push` or async? Sync is simpler; async unlocks Redis-backed buffer without callbacks. **Recommendation:** async, default impl resolves immediately.
- **Q3.** Should `metrics()` reset counters or be cumulative? **Recommendation:** cumulative since boot, with a separate `resetMetrics()` if anyone asks.
