---
name: filter-log-entries
description: 'Drop log entries — per-channel levels whitelist, per-channel filter predicate, logger-wide setMinLevel(level) fast path. Triggers: `levels`, `filter`, `minLevel`, `log.setMinLevel`, `shouldBeLogged`, `LoggingData`, `LogLevel`; "silence a noisy module", "route errors to a dedicated file", "raise global severity floor", "drop debug logs in prod"; typical import `import { log } from "@warlock.js/logger"`. Skip: custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; channel picks — `@warlock.js/logger/pick-log-channel/SKILL.md`; competing libs `pino.levels`, `winston.format.filter`, `debug` env var.'
---

# Filtering — `levels` + `filter` predicate + `minLevel`

Every channel can silently drop entries it doesn't care about. Three mechanisms stack: a logger-wide `minLevel` floor (cheapest), then per-channel `levels` whitelist, then per-channel `filter` predicate.

## 1. `levels` — the per-channel whitelist

```ts
new FileLog({ levels: ["error", "warn"] });
// debug/info/success entries → skipped
// error/warn entries → written
```

- Omitting `levels` (or passing `[]`) means **allow all five**.
- No regex / no range — it's a literal whitelist of `LogLevel` strings.

## 2. `filter` — the per-channel custom predicate

```ts
new ConsoleLog({
  filter: (data) => data.module !== "healthcheck",
});
// Every entry is passed to the predicate; return false → skip.
```

- `data` is the full `LoggingData`: `{ type, module, action, message, context? }`.
- Predicate runs **after** `levels` — an entry blocked by `levels` never reaches `filter`.

## 3. `minLevel` — the logger-wide severity floor

For the common "drop everything below X" case, skip the per-channel `levels` array and use the logger-wide fast path:

```ts
log.setMinLevel("info");
// debug entries are dropped before fan-out — no channel ever sees them.

log.configure({ minLevel: "warn" });   // shorthand inside configure()
```

Severity ordering: `debug < info ≈ success < warn < error`. `success` is treated as informational severity — `setMinLevel("warn")` drops it.

Pass `undefined` to clear:

```ts
log.setMinLevel(undefined);   // accept everything again
```

This runs **before** the channel loop — cheaper than per-channel `levels` filters when you want a uniform floor. Per-channel `levels` and `filter` still run on top for channels that need a tighter or differently-shaped rule.

## Combining — real patterns

### Route errors to a dedicated file

```ts
log.setChannels([
  new ConsoleLog(),
  new FileLog({
    name: "errors",
    levels: ["error", "warn"],
    chunk: "daily",
  }),
]);
// ConsoleLog sees everything; errors.log only grows with warnings and errors.
```

### Silence a noisy module

```ts
new ConsoleLog({
  filter: (data) => data.module !== "socket.io",
});
```

### Keep the dev terminal focused

```ts
// Only surface the subsystem you're actively working on
new ConsoleLog({
  filter: (data) => data.module === "auth",
});
```

### Errors always pass, info only for one module

```ts
new ConsoleLog({
  filter: (data) => data.type === "error" || data.module === "payments",
});
```

## Where filtering happens

`LogChannel.shouldBeLogged(data)` runs both checks in order:

```ts
// levels check — fast path
if (this.config("levels")?.length && !this.config("levels").includes(data.type)) return false;

// filter predicate — only runs if levels allowed it
const filter = this.config("filter");
if (filter) return filter(data);

return true;
```

If you extend `LogChannel` to write a custom channel, call `this.shouldBeLogged(data)` first thing inside your `log(data)` method — you inherit both mechanisms for free. See [`@warlock.js/logger/write-custom-log-channel/SKILL.md`](@warlock.js/logger/write-custom-log-channel/SKILL.md).

## Logger-wide custom filtering — not a thing

There is no `logger.setGlobalFilter()`. Each channel filters itself. If you want the same predicate everywhere, pass it to every channel constructor (or wrap your channels in a helper).

## Performance note

Filters run on **every** entry per channel. A synchronous, cheap predicate is fine. Avoid `await` inside — the channel receives a fully-formed `LoggingData` and the filter is sync-only (type: `(data: LoggingData) => boolean`).

The `minLevel` check is the fastest of the three (single comparison before fan-out), so prefer it when "drop everything below X uniformly" matches your need.
