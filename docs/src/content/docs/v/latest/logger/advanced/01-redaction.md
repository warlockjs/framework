---
title: "Redaction"
description: "Keep secrets out of your logs — dotted-glob paths, wildcards, and additive per-channel layering."
sidebar:
  order: 1
  label: "Redaction"
---

Keep secrets — passwords, tokens, auth headers, PII — out of your logs without sprinkling `delete data.password` across every call site.

## The model

Two layers, both opt-in:

1. **Logger-wide floor** — set once via `configure({ redact })` or `log.setRedact(...)`. Applied **once before fan-out**, so every channel inherits it.
2. **Per-channel additive** — set on individual channels via the `redact` field. Channel paths *extend* the floor; a channel can never undo a logger-wide redaction.

:::tip[The guarantee]
If you set `password` to redact at the logger, no channel can leak it. Audit one place, sleep at night.
:::

## Logger-wide floor

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.configure({
  channels: [new ConsoleLog(), new FileLog({ chunk: "daily" })],
  redact: {
    paths: [
      "context.password",
      "context.*.token",
      "context.headers.authorization",
    ],
    censor: "[REDACTED]", // optional — string or function. Default "[REDACTED]"
  },
});
```

Or at runtime:

```ts
log.setRedact({ paths: ["context.password"] });
log.setRedact(undefined); // clear the floor
```

Read the active config with `log.getRedact()`.

## Per-channel additive

A channel can redact **more** paths than the floor — useful when a destination has a broader audience than the rest of your channels.

```ts
import { log, ConsoleLog, FileLog } from "@warlock.js/logger";

log.configure({
  channels: [
    new ConsoleLog({ showContext: true }), // floor only
    new FileLog({ chunk: "daily" }),        // floor only
    new MyAlertingChannel({                 // floor + own paths
      redact: {
        paths: ["context.user.email", "context.user.phone", "context.metadata.*"],
        censor: "***",
      },
    }),
  ],
  redact: {
    paths: ["context.password", "context.*.token"],
    censor: "[REDACTED]",
  },
});
```

For `log.info("auth", "login", "ok", { user: { email: "x@y.com" }, password: "hunter2" })`:

| Channel | `context.password` | `context.user.email` |
| --- | --- | --- |
| `ConsoleLog` (floor only) | `[REDACTED]` | `x@y.com` |
| `FileLog` (floor only) | `[REDACTED]` | `x@y.com` |
| `MyAlertingChannel` (floor + own) | `***` | `***` |

When a channel provides its own `censor`, it overrides the logger censor for *both* sets of paths in that channel only — the floor's censor still applies on the other channels.

## Path syntax

Paths are dotted glob patterns, evaluated against the full `LoggingData` object (prefix with `context.` or `message.` to scope).

| Pattern | Matches |
| --- | --- |
| `context.password` | exactly `data.context.password` |
| `context.*.token` | `data.context.<any>.token` (one segment in between) |
| `context.users.*.token` | array elements (`*` matches indices) |
| `**.password` | `data.context.password`, `data.context.user.password`, … any depth |
| `message.apiKey` | when `message` is an object, `data.message.apiKey` |

Wildcards:

- `*` — exactly one segment (any object key, any array index).
- `**` — zero or more segments, greedily; matches at any depth.

## Censor variants

```ts
// Literal string — every match becomes this value.
{ censor: "[REDACTED]" }
{ censor: "***" }

// Function — receives original value + dotted path, returns the replacement.
{
  censor: (value, path) => {
    if (typeof value !== "string") return "[REDACTED]";
    return value.length > 4
      ? `${value.slice(0, 2)}***${value.slice(-2)}`
      : "***";
  },
}
```

Function censors are called for every match — keep them cheap. The `path` argument is the actual matched location, e.g. `"context.users.0.token"` for an array hit, so you can branch on it.

## Immutability and edge cases

- **Always returns a deep clone.** Your input data is never mutated.
- **`Date` and `Error` instances are reconstructed** so `instanceof` checks still pass downstream.
- **Circular references are tolerated** — the cloner uses an internal `WeakMap` to break cycles.
- **No-op fast path:** when redact is undefined or `paths` is empty, no clone happens.

## What about the `message` field?

If `message` is a plain object, paths under `message.*` work as expected. If `message` is a string (the most common case), redaction won't scan it — string scrubbing requires regex and is intentionally out of scope. **Wrap secrets in `context`** and they'll be redacted reliably.

## Performance

| Setup | Cost per `log()` call |
| --- | --- |
| No redact configured | Zero — fast path, no clone |
| Logger-wide redact only | One deep clone + one path-walk, shared by every channel |
| Channel adds paths | That channel re-clones from the original input and runs the merged pass once; other channels still share the cheaper logger-wide clone |

Cost grows linearly with `paths.length`. The only pattern that truly scans every key is `**` — profile before relying on it at very high volume.

## See also

- [Configuration](../getting-started/02-configuration/) — wiring `redact` through `configure()`
- [Types · `RedactConfig`](../reference/04-types/) — the full TypeScript type
- [`setRedact` / `getRedact`](../reference/01-logger/) — the runtime methods
