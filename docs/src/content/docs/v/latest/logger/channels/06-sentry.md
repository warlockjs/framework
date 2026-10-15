---
title: "Sentry channel"
description: "Forward log entries to Sentry — errors and warnings as events, everything else as breadcrumbs."
sidebar:
  order: 6
  label: "Sentry channel"
---

`SentryLog` forwards log entries to [Sentry](https://sentry.io). It's the one built-in channel that needs an external SDK, so `@sentry/node` is an **optional peer** — install it only if you use this channel:

```bash
npm install @sentry/node
```

## Wiring it up

### Reuse an existing Sentry client

If your app already calls `Sentry.init(...)`, pass the namespace as `client`. The channel forwards through it and never re-imports or re-initializes the SDK:

```ts
import * as Sentry from "@sentry/node";
import { log, SentryLog } from "@warlock.js/logger";

Sentry.init({ dsn: process.env.SENTRY_DSN, environment: "production" });

log.addChannel(new SentryLog({ client: Sentry }));
```

### Let the channel initialize Sentry

Pass `options` instead, and the channel lazily imports `@sentry/node` and calls `Sentry.init` once — guarded so it never clobbers an existing client:

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

This is the quota-control decision. Only the levels in `eventLevels` create Sentry **events** (which consume your error quota); every other level becomes a **breadcrumb** that rides along with the next event for free.

| Logger level | Default | Sentry call |
| --- | --- | --- |
| `fatal` | event | `captureException` for an `Error` message, otherwise `captureMessage(…, "fatal")` |
| `error` | event | `captureException` for an `Error` message, otherwise `captureMessage(…, "error")` |
| `warn` | event | `captureMessage(…, "warning")` |
| `success` | breadcrumb | `addBreadcrumb({ level: "info" })` |
| `info` | breadcrumb | `addBreadcrumb({ level: "info" })` |
| `debug` | breadcrumb | `addBreadcrumb({ level: "debug" })` |

- **Errors keep their stack.** An `Error` message goes through `captureException`, so Sentry parses the real stack and groups correctly — the channel never pre-stringifies it.
- **`module` / `action` become tags** and the entry's `context` becomes a structured Sentry context, both scoped to that single event via `withScope`.
- **`success` has no Sentry severity** — it is reported as `info`.

:::caution[Don't event-ify everything]
Putting `info` / `debug` / `success` in `eventLevels` floods your Sentry error quota. Keep them as breadcrumbs — that's the default.
:::

```ts
// Only errors create events; warnings drop to breadcrumbs.
new SentryLog({ client: Sentry, eventLevels: ["error"] });
```

`levels` and `filter` from `BasicLogConfigurations` apply first — a channel-level `levels: ["error", "warn"]` drops everything else before it reaches Sentry.

## Draining on shutdown

Sentry sends events asynchronously, so a synchronous flush can't wait on them. `SentryLog.flush()` calls `Sentry.flush(timeout)` — drain it on your graceful-shutdown path with `await log.flush()`:

```ts
async function shutdown() {
  await httpServer.close();
  await log.flush(); // SentryLog.flush() → Sentry.flush(flushTimeout)
  process.exit(0);
}

process.once("SIGTERM", shutdown);
```

`flushTimeout` (default `2000` ms) bounds the wait so an unreachable Sentry can't hang shutdown.

:::note[autoFlushOn does not drain Sentry]
`autoFlushOn` uses the synchronous `flushSync()`, which a network channel can't implement. Wire `await log.flush()` from your own handler — see [Shutdown & flushing](../advanced/03-shutdown-and-flushing/).
:::

## If `@sentry/node` isn't installed

The channel never crashes your app. The dynamic import failure is swallowed, the install instructions are written to stderr **once**, and entries are dropped silently thereafter — so registering `SentryLog` in shared config is safe even where Sentry isn't installed.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `client` | Sentry namespace / forwarder | — | Reuse an already-initialized Sentry instance. |
| `options` | `SentryInitOptions` | — | Sentry init options (mirrors `@sentry/node`'s `NodeOptions`). |
| `eventLevels` | `LogLevel[]` | `["fatal", "error", "warn"]` | Levels sent as events; the rest become breadcrumbs. |
| `flushTimeout` | `number` | `2000` | Milliseconds `flush()` waits for the transport to drain. |

Plus everything from `BasicLogConfigurations` (`levels`, `filter`, `dateFormat`, `redact`).

## See also

- [Shutdown & flushing](../advanced/03-shutdown-and-flushing/) — `await log.flush()` for network channels
- [Custom Channel](./05-custom/) — build a channel for any other destination
- [Channels Overview](./01-overview/) — all built-in channels at a glance
