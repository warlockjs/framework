# @warlock.js/logger

Structured, multi-channel logging for Node.js — five severity levels, a clean three-argument API, and full TypeScript support. Non-blocking by default; synchronous or async flush on demand.

## Install

```bash
npm install @warlock.js/logger
# or
yarn add @warlock.js/logger
```

## 30-second tour

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.setChannels([
  new ConsoleLog(),
  new FileLog({ chunk: "daily" }),
]);

await log.info("users", "register", "New user created");
await log.error("payments", "charge", new Error("Card declined"));
```

The logger starts with no channels — nothing is printed or written until you register at least one.

## The module · action · message pattern

Every call carries three pieces of context. Modules and actions become searchable keys in file and JSON channels:

```ts
await log.info("auth", "login", "User signed in");
await log.warn("api", "rateLimitApproaching", "80% of quota used");
await log.success("payments", "captured", "Payment of $49.99 captured");
```

Pass an object instead of positional args when you need `context` metadata:

```ts
await log.error({
  module: "orders",
  action: "checkout",
  message: "Card declined",
  context: { orderId: "ord_9f2a", amount: 4999 },
});
```

## Levels

`debug` · `info` · `warn` · `error` · `success` — each has a shorthand method on the `log` singleton (and on every `Logger` instance).

## Built-in channels

| Channel | Name | Purpose |
|---|---|---|
| `ConsoleLog` | `"console"` | Colorized terminal output |
| `FileLog` | `"file"` | Plain-text files, optional chunking + rotation + grouping |
| `JSONFileLog` | `"fileJson"` | Structured JSON files — ideal for aggregators |
| `SentryLog` | `"sentry"` | Forwards to Sentry (events + breadcrumbs); needs the optional `@sentry/node` peer |

All channels share the `BasicLogConfigurations` options (`levels`, `filter`, `dateFormat`); `FileLog` / `JSONFileLog` add storage, chunking, rotation, and grouping options, and `SentryLog` adds `client` / `options` / `eventLevels`.

## `log` and `Logger`

The package exports one default singleton and one class:

- **`log`** — a pre-instantiated `Logger`. Day-to-day logging *and* configuration both go through it: `log.info(...)`, `log.configure(...)`, `log.flush()` / `log.flushSync()`, `log.addChannel(...)`.
- **`Logger`** — the class. Use it when you need an isolated logger (libraries, sandboxes, parallel test suites).

`log` is a `Logger` instance, not a function — every level shortcut and configuration method is reachable on it. The bare-callable `log(data)` form was removed; use `log.log(data)` for the data-object form, or `log.info(...)` / `log.error(...)` / etc. for the positional form.

## Graceful shutdown

`FileLog` and `JSONFileLog` buffer entries. Tell the logger to drain them on exit:

```ts
log.configure({
  channels: [new ConsoleLog(), new FileLog({ chunk: "daily" })],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
```

Signal events flush then re-raise (so Node exits with its normal signal semantics); `beforeExit` flushes in place. For full control, call `log.flushSync()` (sync) — or `await log.flush()` (async, for network/async channels) — inside your own handler instead.

## Capturing unhandled errors

```ts
import { captureAnyUnhandledRejection } from "@warlock.js/logger";

captureAnyUnhandledRejection();
```

Registers process-level handlers for `unhandledRejection` and `uncaughtException`, forwarding both to `log.error("app", ...)`. Call once at startup, after channels are registered.

## Custom channels

Extend `LogChannel` and implement `log(data)`:

```ts
import { LogChannel, type LoggingData } from "@warlock.js/logger";

export class SlackLog extends LogChannel<{ webhookUrl: string }> {
  public name = "slack";

  public async log(data: LoggingData) {
    if (!this.shouldBeLogged(data)) return;
    await fetch(this.config("webhookUrl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[${data.type}] [${data.module}][${data.action}]: ${data.message}`,
      }),
    });
  }
}
```

Set `terminal = true` on the class if your channel writes to a TTY — otherwise ANSI codes are auto-stripped from string messages.

## Full documentation

The complete guide lives in the project docs:

- Getting Started
- Configuration
- Channels (ConsoleLog, FileLog, JSONFileLog, SentryLog)
- Lifecycle & Flushing
- Capturing Unhandled Errors
- Custom Channels
- Recipes
- API Reference
- Types

## Tests

This package uses Vitest. From the repo root:

```bash
npx vitest run --root @warlock.js/logger
```

## License

MIT
