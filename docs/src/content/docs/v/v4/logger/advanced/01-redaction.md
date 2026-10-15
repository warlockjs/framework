---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Redaction"
description: "Keep secrets out of your logs — dotted-glob paths, wildcards, and additive per-channel layering."
sidebar:
  order: 1
  label: "Redaction"
---

Keep secrets — passwords, tokens, auth headers, PII — out of your logs without sprinkling `delete data.password` across every call site.

## The model

Three layers. The first is on by default; the other two are opt-in:

0. **Built-in key denylist** (since 4.15.0) — `DEFAULT_REDACT_KEYS` censors common secret key names (passwords, tokens, API/private keys, credential headers, session ids, connection strings, high-sensitivity financial PII) at any depth of `context`, `message`, and an `Error`'s own enumerable properties, with **no configuration required**. Same logger-wide choke point as the layers below, so every channel — including custom ones — inherits it.
1. **Logger-wide floor** — set once via `configure({ redact })` or `log.setRedact(...)`. Applied **once before fan-out**, so every channel inherits it.
2. **Per-channel additive** — set on individual channels via the `redact` field. Channel paths *extend* the floor; a channel can never undo a logger-wide redaction — including the built-in denylist from layer 0.

:::tip[The guarantee]
If you set `password` to redact at the logger, no channel can leak it. Audit one place, sleep at night.
:::

## Layer 0 — the default denylist (no configuration needed)

```ts
log.error("auth", "login", "failed", { headers: req.headers, body: req.body });
// context.headers.authorization → "[REDACTED]"
// context.body.password         → "[REDACTED]"
// context.body.email            → untouched
```

Keys are matched **exactly**, on a normalized form (lower-cased, separators stripped) — so one entry covers `apiKey` / `api_key` / `API-KEY` / `x-api-key`. It is not substring matching: `tokenCount` and `passwordUpdatedAt` survive untouched.

```ts
import { log, DEFAULT_REDACT_KEYS } from "@warlock.js/logger";

log.configure({
  redact: {
    keys: ["internalRef"], // union with the built-in set
    defaultKeys: false,     // opt out of the built-in set entirely
  },
});
```

`defaultKeys: false` is an escape hatch, not a tuning knob — it restores the pre-4.15.0 behavior where a `password` in `context` reaches every sink in cleartext. Prefer adding a `censor` function if you only need to mask a value rather than blank it. As with `paths`, **a channel cannot turn the default denylist off** — it can only add keys, or turn it back on if the logger-wide config disabled it.

Not reachable by any layer: secrets interpolated into a `message` *string* (`` `token=${t}` ``), `Map`/`Set`/`Buffer` contents, and getter-backed or non-enumerable properties.

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
- **No-op fast path:** the deep clone only happens when something actually matches — either a `paths` glob or a denylisted key (default or custom). With `{ defaultKeys: false }` and no `paths`/`keys`, nothing runs at all.

## What about the `message` field?

If `message` is a plain object, paths under `message.*` work as expected. If `message` is a string (the most common case), redaction won't scan it — string scrubbing requires regex and is intentionally out of scope. **Wrap secrets in `context`** and they'll be redacted reliably.

## Performance

| Setup | Cost per `log()` call |
| --- | --- |
| Nothing configured | The default denylist still runs: a cheap presence scan for a denylisted key, with the clone + censor pass skipped when nothing matches |
| `{ defaultKeys: false }`, no `paths`/`keys` | Zero — fast path, no clone, no scan |
| Logger-wide redact only | One deep clone + one path-walk, shared by every channel |
| Channel adds paths | That channel re-clones from the original input and runs the merged pass once; other channels still share the cheaper logger-wide clone |

Cost grows linearly with `paths.length`. The only pattern that truly scans every key is `**` — profile before relying on it at very high volume.

## See also

- [Configuration](../getting-started/02-configuration/) — wiring `redact` through `configure()`
- [Types · `RedactConfig`](../reference/04-types/) — the full TypeScript type
- [`setRedact` / `getRedact`](../reference/01-logger/) — the runtime methods
