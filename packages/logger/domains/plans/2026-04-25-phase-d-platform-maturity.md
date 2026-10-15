# 2026-04-25 — Phase D: Platform maturity

**Status:** not-started
**Started:** —
**Context:** [backlog](../backlog.md#phase-d--platform-maturity) · the boring, reliable polish. Most of these are why teams *keep* the logger after they've adopted it.

## Goal

Pluggable formatters (ECS, pino-compat, OTel-ready), custom levels with TS autocomplete, and operational features (dedupe, hot reload, OTel bridge).

## Tasks

### D1 — Pluggable formatters

- [ ] Define `Formatter` interface — single method `format(message: LogMessage): string | object`
- [ ] Built-in formatters:
  - [ ] `defaultLineFormatter` — current `[date] [level] [module][action]: message` format
  - [ ] `defaultJsonFormatter` — current `JSONFileLog` shape
  - [ ] `ecsFormatter` — Elastic Common Schema (`@timestamp`, `log.level`, `service.name`, `event.action`, etc.)
  - [ ] `pinoCompatFormatter` — pino-flavored `{ level: 30, time, msg, ... }`
  - [ ] `logfmtFormatter` — `key=value` plaintext
- [ ] `FileLog({ formatter })` and `JSONFileLog({ formatter })` accept a formatter
- [ ] Tests — round-trip each formatter against a known `LogMessage`

### D2 — Custom levels

- [ ] Runtime: `defineLevel(name, { rank: number, color?: string, terminalIcon?: string })`
- [ ] Sorted level table maintained on `Logger`; `shouldBeLogged` honors custom levels in `levels` arrays
- [ ] `log[name](...)` and `logger[name](...)` available at runtime via dynamic property
- [ ] Documented TS augmentation pattern (`declare module "@warlock.js/logger" { interface Log { audit(...): ...; } }`)
- [ ] Skill subdoc walks through both halves with copy-paste example
- [ ] Tests — runtime registration, augmentation example compiles, level filtering works

### D3 — OpenTelemetry bridge

- [ ] `OtelChannel` (lives in `logger-adapters` Phase C, but spec'd here) emitting `LogRecord` via `@opentelemetry/api-logs`
- [ ] Auto-correlate with active OTel trace (`trace_id` / `span_id` from current context)
- [ ] Severity mapping: debug→DEBUG, info→INFO, warn→WARN, error→ERROR, success→INFO2 (custom)
- [ ] Tests against an in-memory OTel exporter

### D4 — Logger-wide minimum level ✅ (shipped 2026-04-25)

- [x] `Logger.setMinLevel("info"): this` — drops everything below on every channel
- [x] Stored on `Logger` instance; checked in `Logger.log` before fan-out (cheap fast path)
- [x] `configure({ minLevel: "info" })` shorthand
- [x] Tests — set `minLevel: "warn"`, confirm no channel sees `info`/`debug`

### D5 — Deduplication

- [ ] `Logger.configure({ dedupe: { window: "5m", key: ["module", "action", "message"] } })`
- [ ] Maintains an in-memory map of `key-hash → { firstSeenAt, count }`
- [ ] Within window: increments counter, suppresses duplicate
- [ ] On window expiry / first sighting: emits `[deduped: 47]` suffix on the first re-fire
- [ ] Memory bounded — LRU on the dedupe map (reuse `LRUBufferStore` from Phase A?)
- [ ] Tests — confirm exact counts under burst, confirm window expiry

### D6 — Hot-reload of configuration

- [ ] `Logger.reloadConfig(loaderFn: () => LoggerConfig | Promise<LoggerConfig>)`
- [ ] `Logger.watchConfig(filePath)` — calls `reloadConfig` on file change
- [ ] `Logger.onSighup()` — convenience that wires `process.on("SIGHUP", reloadConfig)`
- [ ] Disconnects old channels gracefully (await `flushAsync` first)
- [ ] Tests — change a watched config file, confirm new channel set is active

## Verification

- Existing tests pass
- New test target: +50 across D1–D6
- ECS smoke test: log an entry, parse it as JSON, confirm it round-trips through Elastic Common Schema validator
- Custom levels smoke: register `audit`, call `log.audit(...)`, confirm both runtime and TS work

## Critical files

- `@warlock.js/logger/src/formatters/formatter.contract.ts` (new)
- `@warlock.js/logger/src/formatters/{default,ecs,pino-compat,logfmt}-formatter.ts` (new × 4)
- `@warlock.js/logger/src/levels.ts` (new — runtime level registry)
- `@warlock.js/logger/src/dedupe.ts` (new)
- `@warlock.js/logger/src/config-watcher.ts` (new)
- `@warlock.js/logger/src/logger.ts` (`setMinLevel`, custom-level proxy, dedupe in `log()`)
- `@warlock.js/logger/src/types.ts` (extend `BasicLogConfigurations` with `formatter`, extend `LogConfig` with `dedupe`/`minLevel`)
- `@warlock.js/logger-adapters/src/transports/otel-channel.ts` (Phase C, spec'd here)
- `domains/logger/skills/subskills/formatters.md` (new)
- `domains/logger/skills/subskills/custom-levels.md` (new)
- `domains/logger/skills/subskills/dedupe.md` (new)

## Estimate

~3 weeks.

## Open questions

- **Q1.** Should custom levels affect `LogLevel` type at runtime via TS magic, or do users always need manual augmentation? **Recommendation:** manual augmentation — JS-side runtime registration plus a documented `declare module` pattern. Cascade does similar.
- **Q2.** Dedupe key default — `["module", "action", "message"]` includes the message. Use `JSON.stringify(message)` if it's an object? **Recommendation:** stringify with depth limit; hash the result so the dedupe map stores fixed-size keys.
- **Q3.** OTel severity for `success` level — there's no native equivalent. **Recommendation:** map to `INFO2` (severity number 10) and document the custom mapping.
