---
title: "Your first log"
description: "The call-site API — module / action / message, the five levels, structured context, errors, and the timer + assert helpers."
sidebar:
  order: 3
  label: "Your first log"
---

Once a channel is attached, you log through the `log` singleton. Every entry follows the same shape: `module`, `action`, `message`, and an optional `context` object.

## The module · action · message pattern

Every log call takes three positional arguments — **module**, **action**, **message** — plus an optional fourth **context** object for structured data.

```ts
await log.info("users", "register", "New user created", { userId: 42 });
//            ^^^^^^^ ^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^
//            module   action      message               context (optional)
```

The first three let you filter and search logs by feature area instead of wading through flat text; the fourth carries the structured metadata. Real-world examples across domains:

```ts
// Auth
await log.info("auth", "login", "User signed in");
await log.warn("auth", "tokenExpired", "JWT expired for session");

// Payments — message in the 3rd arg, structured data in the 4th (context)
await log.info("payments", "chargeInitiated", "Charge initiated", { amount: 4999, currency: "USD" });
await log.error("payments", "chargeFailed", new Error("Stripe declined card"));

// Email
await log.success("email", "welcomeSent", "Welcome email delivered");
await log.warn("email", "bounced", "Delivery failed — invalid address");

// Orders
await log.debug("orders", "priceCalculation", "Calculated cart total", { subtotal: 120, discount: 10 });
await log.success("orders", "fulfillment", "Order shipped via FedEx");
```

:::tip[Naming style]
Pick one style and stay consistent — `module` and `action` become searchable keys in file and JSON channels. Both `camelCase` (`"tokenExpired"`) and `kebab-case` (`"abandon-stale"`) are common; the Warlock backend codebases lean on kebab-case so action names read like the verb-phrase they describe.
:::

## The six log levels

| Level | Method | When to use | Console style |
| --- | --- | --- | --- |
| `debug` | `log.debug()` | Dev diagnostics, variable dumps, flow tracing | magenta |
| `info` | `log.info()` | Normal operational events (user registered, job queued) | blue |
| `warn` | `log.warn()` | Unexpected but recoverable conditions (retry, fallback) | yellow |
| `error` | `log.error()` | Handled failures that need attention; app continues | red |
| `success` | `log.success()` | Explicit happy-path confirmation (payment completed) | green |
| `fatal` | `log.fatal()` | Unrecoverable failures; the app is going down (boot fail, `uncaughtException`) | bright red on red background |

```ts
await log.debug("cache", "miss", "Key not found, fetching from DB");
await log.info("jobs", "queued", "SendInvoice job added to queue");
await log.warn("api", "rateLimitApproaching", "80% of quota used");
await log.error("db", "connectionFailed", new Error("ECONNREFUSED 5432"));
await log.success("payments", "captured", "Payment of $49.99 captured");
await log.fatal("config", "missingSecret", new Error("STRIPE_KEY is required to boot"));
```

:::note[`fatal` is a level, not an action]
`log.fatal(...)` writes a log entry at the highest severity — it does NOT call `process.exit()` or auto-flush. The caller decides what to do next (typically `await log.flush()` then exit). This keeps `fatal` composable with the rest of the pipeline.
:::

## Structured logging — the context object

To attach arbitrary metadata, pass a fourth `context` argument, or pass a full `LoggingData` object to `log.log(...)`.

```ts
// Fourth argument — context
await log.info("orders", "checkout", "Order placed", {
  orderId: "ord_9f2a",
  userId: 101,
  amount: 4999,
});

// Object form — log.log(...)
import { log, type LoggingData } from "@warlock.js/logger";

const entry: LoggingData = {
  type: "error",
  module: "orders",
  action: "checkout",
  message: "Card declined",
  context: {
    orderId: "ord_9f2a",
    userId: 101,
    amount: 4999,
    retryCount: 2,
  },
};

await log.log(entry);
```

File and JSON channels persist `context` alongside the entry. The console channel renders it on a second line only when its `showContext` option is enabled — see [Console Channel](../channels/02-console/).

## Logging errors

Pass an `Error` instance directly as the `message` argument. File and JSON channels capture the stack trace automatically.

```ts
try {
  await processPayment(orderId);
} catch (err) {
  await log.error("payments", "processPayment", err);
}
```

:::caution
Always pass the raw `Error` object — do **not** stringify it first (`err.message`). Passing the object lets the file channels record the full stack trace.
:::

## Helpers — `timer` and `assert`

Two shortcuts every `Logger` exposes.

### `timer(module, action)` — measure a duration

Returns an end-function that emits an `info` entry with a `durationMs` field in `context` when called.

```ts
const end = log.timer("db", "users.findById");
const user = await usersRepo.findById(id);
end({ id, found: !!user });
// → info "db" "users.findById" "completed in 42ms" { durationMs: 42, id, found: true }
```

Pass an object to the end-function to merge extra fields into the context.

### `assert(condition, module, action, message, context?)` — log on a failed invariant

Logs an `error` entry only when `condition` is falsy. A no-op otherwise — the entry is never built and channels aren't invoked, so it's free on the happy path. Like `console.assert`, but it routes through the logger pipeline so persistent channels capture the failure.

```ts
log.assert(user !== null, "auth", "session", "user vanished mid-flight", { sessionId });
```

## Next

You've covered the call-site API. Next, learn how channels decide what to emit and where — start with the [Channels Overview](../channels/01-overview/).

Or jump straight to a task-shaped guide:

- [Log to a rotating file in production](../recipes/01-rotating-file-in-production/)
- [Attach request / trace context](../recipes/02-request-and-trace-context/)
- [Ship errors to Slack](../recipes/03-ship-errors-to-slack/)
- [Silence noisy logs per environment](../recipes/04-silence-noisy-logs/)
