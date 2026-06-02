---
name: redact-sensitive-log-fields
description: 'Strip secrets from log output — two-layer additive redaction via log.configure({redact: {paths}}) (logger floor) + per-channel redact (more paths on top). Dotted glob paths (*, **). Triggers: `redact`, `paths`, `censor`, `log.setRedact`, `applyRedact`; "redact passwords in logs", "strip tokens from log output", "hide authorization headers", "scrub PII before logging"; typical import `import { log } from "@warlock.js/logger"`. Skip: filtering — `@warlock.js/logger/filter-log-entries/SKILL.md`; custom sinks — `@warlock.js/logger/write-custom-log-channel/SKILL.md`; competing libs `pino.redact`, `fast-redact`.'
---

# Redaction — keeping secrets out of logs

Two layers, both opt-in. Configured at the logger and/or per channel.

## The model in one line

> Logger-wide redaction is the security floor. Per-channel redaction adds more paths. **No channel can ever undo a logger-wide redaction.**

That guarantee is the whole point — once you've set `password` to redact at the logger, you can audit one place to know nothing leaks it, regardless of how many channels you add.

## Logger-wide floor

```ts
import { log } from "@warlock.js/logger";

log.configure({
  redact: {
    paths: [
      "context.password",
      "context.*.token",
      "context.headers.authorization",
    ],
    censor: "[REDACTED]",  // default — string or function
  },
});

// runtime equivalent:
log.setRedact({ paths: ["context.password"] });
log.setRedact(undefined);  // clear
```

Every channel sees the redacted entry. Cheap: applied **once** before fan-out; channels share the redacted clone unless they add their own paths.

## Per-channel additive

```ts
new SlackChannel({
  webhook: "...",
  redact: {
    paths: ["context.user.email", "context.metadata.*"],
    // censor inherited from logger-wide when omitted
  },
});
```

The channel's `paths` are **merged** with the logger floor — the channel runs a single combined redact pass, never replaces the floor. The channel's `censor` (if provided) wins for both its own and the logger's paths in this channel only; the logger floor still uses its own censor for other channels.

### When to set redact per-channel

- Loud destinations with broader audiences (Slack, Discord, error trackers, anything off your machine) — redact more aggressively.
- Local-only destinations (FileLog you alone read, the dev terminal) — keep the floor minimal so you can debug.

### When NOT to set it

If you want raw context in your dev terminal, **don't add redact at the logger level** — set it only on the file/JSON/network channels. Logger-wide is the floor, so it applies everywhere; you can't opt a single channel out.

## Path syntax

Paths are dotted glob patterns evaluated against the full `LoggingData`:

```
type LoggingData = {
  type: "info" | ...,
  module: string,
  action: string,
  message: any,        // ← prefix paths with "message." to redact here
  context?: object,    // ← prefix paths with "context." to redact here
};
```

| Pattern | Matches |
| --- | --- |
| `context.password` | exactly `data.context.password` |
| `context.*.token` | `data.context.<any>.token` (one segment in between) |
| `**.password` | `data.context.password`, `data.context.user.password`, … any depth |
| `message.apiKey` | when message is an object, `data.message.apiKey` |
| `context.users.*.token` | array element redaction (`*` matches indices too) |

Wildcards:

- `*` — exactly one segment (any object key, any array index).
- `**` — zero or more segments, greedily; matches at any depth.

## Censor variants

```ts
// String — replace with a literal.
{ censor: "[REDACTED]" }
{ censor: "***" }

// Function — receives original value + dotted path, returns the replacement.
{
  censor: (value, path) => {
    if (typeof value !== "string") return "[REDACTED]";
    return value.length > 4 ? `${value.slice(0, 2)}***${value.slice(-2)}` : "***";
  },
}
```

Function censors are called for every match — keep them cheap. The path is the actual matched location (e.g. `"context.users.0.token"` for an array hit).

## Immutability

`applyRedact` always returns a deep clone — your input data is never mutated. `Date` and `Error` instances are reconstructed (so `instanceof` checks still work). Circular references are tolerated.

## What about the `message` field?

If `message` is a plain object, paths under `message.*` work as expected. If `message` is a string (the most common case), redaction won't scan it — string scrubbing requires regex and is out of scope for this primitive. Wrap secrets in `context` and they'll be redacted reliably.

## Performance notes

- **No redact configured** → zero overhead (no clone, no walk).
- **Logger-wide redact only** → one deep clone + one path-walk per `log()` call, shared by every channel.
- **Channel adds paths** → that channel re-clones from the original input and runs the merged pass once. Other channels still share the cheaper logger-wide clone.
- Each path is matched independently; cost grows linearly with `paths.length`.

For most apps with `<10` redact paths and shallow context, the cost is below 100µs per entry. If you're logging millions of entries per second through paths like `**.something`, profile before scaling up — `**` is the only pattern that recurses through every key.
