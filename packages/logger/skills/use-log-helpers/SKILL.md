---
name: use-log-helpers
description: 'Two DX shortcuts on every Logger — log.assert(condition, module, action, message, context?) logs an error when condition is falsy (free on the happy path), log.timer(module, action) returns an end-function emitting an info entry with measured duration. Triggers: `log.assert`, `log.timer`, `durationMs`; "assert an invariant via logger", "measure how long an operation took", "time a request", "log operation duration"; typical import `import { log } from "@warlock.js/logger"`. Skip: basics — `@warlock.js/logger/logger-basics/SKILL.md`; filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; competing `console.assert`, `console.time`, `console.timeEnd`, `perf_hooks.performance.now`.'
---

# Helpers — `assert`, `timer`

Two small DX shortcuts on every `Logger` (and the bound `log` helper). They route through the normal log pipeline — every channel sees what they emit.

## `log.assert(condition, module, action, message, context?)`

Logs an `error` entry when `condition` is falsy. Genuinely free in the happy path: when the condition is truthy, the entry is never built and channels are never invoked.

```ts
log.assert(user !== null, "auth", "session", "user vanished mid-flight", {
  sessionId,
});

// truthy → no log call
// falsy  → equivalent to log.error("auth", "session", "user vanished...", { sessionId })
```

The level is implicitly `error` — assertions express failures, not warnings. If you need a non-error level, use `log.error` / `log.warn` directly with your own `if`.

### Why not `console.assert`?

`console.assert` writes to stderr only and bypasses your file/JSON channels. `log.assert` runs through the logger pipeline, so a failed assertion is captured by every persistent channel you've configured. See [`@warlock.js/logger/pick-log-channel/SKILL.md`](@warlock.js/logger/pick-log-channel/SKILL.md).

## `log.timer(module, action)`

Returns an end-function. Calling it emits an `info` entry with `completed in <ms>ms` and a `durationMs` field in `context`.

```ts
const end = log.timer("db", "users.findById");
const user = await usersRepo.findById(id);
end({ id, found: !!user });
// ℹ info [db] [users.findById] completed in 12ms
//   ↳ { durationMs: 12, id: "abc", found: true } (when ConsoleLog has showContext: true)
```

Common patterns:

```ts
// Around an HTTP handler
async function handle(req) {
  const end = log.timer("http", `${req.method} ${req.url}`);
  try {
    return await runHandler(req);
  } finally {
    end({ status: res.statusCode });
  }
}

// Around a job
const end = log.timer("jobs", "nightly-report");
await report.run();
end({ rowsProcessed: report.rowCount });
```

`end()` can be called more than once if you want intermediate checkpoints — each call emits a fresh entry with the duration measured from the original `timer()` call.

### Caveats

- The duration is `Date.now()` based — millisecond resolution. For sub-millisecond profiling, reach for `performance.now()` directly.
- The end-function captures `this` at construction; calling it after the logger is reconfigured still routes through the same `Logger` instance.
- `log.timer` shorthand binds to the singleton — see [`@warlock.js/logger/test-logging-code/SKILL.md`](@warlock.js/logger/test-logging-code/SKILL.md) for how to swap channels per test.
