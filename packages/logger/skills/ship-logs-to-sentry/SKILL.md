---
name: ship-logs-to-sentry
description: 'Forward log entries to Sentry with the SentryLog channel — error/warn become events (captureException/captureMessage), every other level a breadcrumb (no quota). @sentry/node is an OPTIONAL peer, lazily imported. Triggers: `SentryLog`, `@sentry/node`, `eventLevels`, `flushTimeout`, `Sentry.flush`, `captureException`, `addBreadcrumb`, `withScope`; "send logs to Sentry", "report errors to Sentry", "Sentry log channel", "Sentry breadcrumbs from logs", "log channel for Sentry"; typical import `import { SentryLog } from "@warlock.js/logger"`. Skip: file/console channels — `@warlock.js/logger/pick-log-channel/SKILL.md`; custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; graceful-shutdown flushing — `@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`; Slack alerting recipe.'
---

# Ship logs to Sentry — the `SentryLog` channel

`SentryLog` forwards log entries to Sentry. It's the one built-in channel that needs an external SDK, so `@sentry/node` is an **optional peer** — install it only if you use this channel:

```bash
npm install @sentry/node
```

## Two ways to wire it

### Reuse an existing Sentry client (existing apps)

If your app already calls `Sentry.init(...)`, pass the namespace as `client`. The channel forwards through it and never re-imports or re-initializes the SDK:

```ts
import * as Sentry from "@sentry/node";
import { log, SentryLog } from "@warlock.js/logger";

Sentry.init({ dsn: process.env.SENTRY_DSN, environment: "production" });

log.addChannel(new SentryLog({ client: Sentry }));
```

### Let the channel initialize Sentry (new apps)

Pass `options`; the channel lazily imports `@sentry/node` and calls `Sentry.init` once — guarded so it never clobbers an existing client:

```ts
import { log, SentryLog } from "@warlock.js/logger";

log.addChannel(
  new SentryLog({
    options: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      release: process.env.GIT_SHA,
    },
  }),
);
```

With neither `client` nor `options`, the channel reuses whatever global Sentry client the host already initialized.

## How levels map to Sentry

This is the quota-control decision. Only `eventLevels` create Sentry **events** (which consume your error quota); every other level becomes a **breadcrumb** that rides along with the next event for free.

| Logger level | Default | Sentry call |
|---|---|---|
| `error` | event | `captureException` for an `Error` message, else `captureMessage(…, "error")` |
| `warn` | event | `captureMessage(…, "warning")` |
| `success` | breadcrumb | `addBreadcrumb({ level: "info" })` |
| `info` | breadcrumb | `addBreadcrumb({ level: "info" })` |
| `debug` | breadcrumb | `addBreadcrumb({ level: "debug" })` |

- **Errors keep their stack.** A `message` that is an `Error` goes through `captureException`, so Sentry parses the real stack and groups correctly — never pre-stringify the error.
- **`module` / `action` become tags** and the entry's `context` becomes a structured Sentry context, both scoped to that single event via `withScope`.
- **`success` has no Sentry severity** — it's reported as `info`.

### Tuning what becomes an event

```ts
// Only errors create events; warnings drop to breadcrumbs.
new SentryLog({ client: Sentry, eventLevels: ["error"] });

// Errors + warnings + an info stream as events (noisier, more quota).
new SentryLog({ client: Sentry, eventLevels: ["error", "warn", "info"] });
```

`levels` and `filter` from `BasicLogConfigurations` apply first — a channel-level `levels: ["error", "warn"]` drops everything else before it reaches Sentry at all.

## Draining on shutdown

Sentry sends events asynchronously over the network, so a synchronous flush can't wait on them. `SentryLog.flush()` calls `Sentry.flush(timeout)`; drain it on your graceful-shutdown path:

```ts
async function shutdown() {
  await httpServer.close();
  await log.flush();   // SentryLog.flush() → Sentry.flush(flushTimeout)
  process.exit(0);
}

process.once("SIGTERM", shutdown);
```

`flushTimeout` (default `2000` ms) bounds the wait so an unreachable Sentry can't hang shutdown. `autoFlushOn` uses the **synchronous** `flushSync()`, which does *not* drain Sentry — wire `await log.flush()` yourself. See [`flush-logs-on-shutdown`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md).

## If `@sentry/node` isn't installed

The channel never crashes your app: the dynamic import failure is swallowed, the install instructions are written to stderr **once**, and entries are dropped silently thereafter. So registering `SentryLog` in shared config is safe even in an environment where Sentry isn't installed.

## Config reference

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | Sentry namespace / forwarder | — | Reuse an already-initialized Sentry instance. |
| `options` | `NodeOptions` | — | Init options when the channel owns Sentry. |
| `eventLevels` | `LogLevel[]` | `["error", "warn"]` | Levels sent as events; the rest become breadcrumbs. |
| `flushTimeout` | `number` | `2000` | Ms `flush()` waits for the transport to drain. |
| `levels`, `filter`, `dateFormat`, `redact` | — | — | Inherited from `BasicLogConfigurations`. |

## Don't do

- **Don't double-init Sentry.** Pass *either* `client` *or* `options`, not both. The channel guards against double-init, but a single owner of `Sentry.init` is cleaner.
- **Don't send every level as an event.** `eventLevels` with `info`/`debug`/`success` will flood your Sentry quota — keep them as breadcrumbs.
- **Don't rely on `autoFlushOn` for Sentry.** It's synchronous; a network channel needs `await log.flush()`.

## See also

- [`@warlock.js/logger/flush-logs-on-shutdown/SKILL.md`](@warlock.js/logger/flush-logs-on-shutdown/SKILL.md) — `await log.flush()` on shutdown
- [`@warlock.js/logger/pick-log-channel/SKILL.md`](@warlock.js/logger/pick-log-channel/SKILL.md) — the console / file channels
- [`@warlock.js/logger/write-custom-log-channel/SKILL.md`](@warlock.js/logger/write-custom-log-channel/SKILL.md) — build your own sink
