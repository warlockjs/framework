---
title: "Logging"
description: The log API from @warlock.js/logger — levels, channels (console/file/json), the module/action/message shape, redaction, timers, and per-environment configuration.
sidebar:
  order: 6
  label: "Logging"
---

You need to see what's happening — and you need to see it without leaking secrets, without flooding the terminal in production, and without changing the call site to swap a console for a file logger. Warlock's `log` is a thin singleton over `@warlock.js/logger`, with channels that fan out to terminal, file, JSON, or anywhere else you wire up.

## Mental model

```mermaid
flowchart LR
    call["log.info(module, action, message, context?)"]
    filter["min-level filter<br/><i>drop if below threshold</i>"]
    redact["redaction floor<br/><i>strip configured paths</i>"]
    fanout["fan out to channels"]
    console["ConsoleLog<br/><i>colored terminal</i>"]
    file["FileLog<br/><i>persistent</i>"]
    json["JSONFileLog<br/><i>structured</i>"]

    call --> filter
    filter --> redact
    redact --> fanout
    fanout --> console
    fanout --> file
    fanout --> json
```

Three layers to know:

1. **Levels** — `debug`, `info`, `success`, `warn`, `error`, `fatal`. The min-level filter drops anything below the threshold before fan-out runs.
2. **Channels** — destinations the entry fans out to. Console for terminal, FileLog for human-readable files, JSONFileLog for structured logs that observability tools can ingest. Subscribe to as many as you need.
3. **Redaction** — strip sensitive fields by dotted path before any channel sees the entry. Configured logger-wide; channels can add more paths but never fewer.

## The shape

```ts
import { log } from "@warlock.js/logger";

log.info("auth", "login", "User authenticated", { userId: "abc123" });
log.error("ai", "openai", "Request failed", { error, model: "gpt-4o-mini" });
log.success("upload", "stored", `Uploaded ${size} bytes to ${path}`);
log.warn("cache", "miss", `Cache miss for ${key}`);
log.debug("router", "dispatch", `${request.method} ${request.path}`);
```

The shape is **module / action / message / context** — four positional arguments. Stays scannable in the terminal, stays parseable in JSON logs, keeps grep queries clean.

`log` is re-exported by `@warlock.js/core`, so you can also `import { log } from "@warlock.js/core"`. Pick whichever you prefer — they're the same singleton.

## Levels

Six levels with conventional severity ordering:

| Level     | When to use                                                            |
| --------- | ---------------------------------------------------------------------- |
| `debug`   | Verbose internals — disabled by default in production via min-level    |
| `info`    | Routine events worth observing — request start, job picked up, etc.    |
| `success` | An outcome you want to highlight — same severity as info, separate icon |
| `warn`    | Something unexpected but not actionable — partial failures, fallbacks  |
| `error`   | Something went wrong and you should know about it                      |
| `fatal`   | Unrecoverable failure — the app is going down                          |

Set a minimum level to drop noise before any channel runs:

```ts
log.setMinLevel("info");    // drop debug entries everywhere
log.setMinLevel("warn");    // production-quiet — only warn/error
log.setMinLevel(undefined); // accept all
```

This is cheaper than per-channel `levels` filters — the fan-out loop never runs for dropped entries.

## Configuration — the core wrapper surface

`src/config/log.ts` declares channels per environment. Channels come from `@warlock.js/logger`. The core wrapper that reads this file is `setLogConfigurations()` — and it is deliberately small. **It only reads two things:**

1. `options.channels` — channels active in every environment.
2. `options[env].channels` — extra channels for the current environment, where `env` is **only** `development` or `production`.

It concatenates those two lists and calls `log.configure({ channels })`. That's the whole behaviour.

```ts title="src/config/log.ts"
import { type LogConfigurations } from "@warlock.js/core";
import { ConsoleLog, JSONFileLog } from "@warlock.js/logger";

const consoleLog = new ConsoleLog({
  showContext: true,   // pretty-print context on a second line
});

const logConfigurations: LogConfigurations = {
  channels: [consoleLog],   // runs in every environment
  production: {
    channels: [
      new JSONFileLog({
        storagePath: "/var/log/app",
        rotate: true,
      }),
    ],
  },
};

export default logConfigurations;
```

| Field           | Read by the core wrapper? | Behaviour                                                          |
| --------------- | ------------------------- | ----------------------------------------------------------------- |
| `channels`      | Yes                       | Channels active in **all** environments (merged with env-specific) |
| `development`   | Yes (its `.channels`)     | Channels added on top when the environment is `development`        |
| `production`    | Yes (its `.channels`)     | Channels added on top when the environment is `production`         |

The merge is `[...channels, ...env.channels]` — a channel in `channels` runs everywhere, and `production.channels` adds production-only destinations.

### What the core wrapper does NOT do

The `LogConfigurations` type also exposes `enabled` and `test` fields, but `setLogConfigurations()` **never reads them**:

- **`enabled` is not honoured.** There is no master on/off switch in the core wrapper — setting `enabled: false` does nothing. To silence logging, ship an empty `channels` list (or raise the min-level / use per-channel `levels` — see below).
- **The `test` block is not read.** Only `development` and `production` env blocks are consulted. Under `NODE_ENV=test` (or any environment that isn't `development`/`production`), `options[env]?.channels` resolves to `undefined`, so a `test:` block is silently ignored — only the top-level `channels` apply. Put test channels in `channels` if you need them during tests.

These fields exist on the type for forward-compatibility, but as of today they are inert at the core wrapper. Don't rely on them.

### Reading the resolved config back

The merged channel list is what was handed to `@warlock.js/logger`; the raw declarative object is still available through the config service:

```ts
import { config } from "@warlock.js/core";

const logConfig = config.get("log"); // the LogConfigurations object you exported
```

That returns your exported object as-is (`channels`, `development`, `production`, and the inert `enabled`/`test` fields) — useful for inspection, but remember only `channels` + the current env's `channels` actually drove the logger.

## Channels

Three channels ship with `@warlock.js/logger`. They share a common base — instantiate, pass to the configuration, done.

### ConsoleLog — colored terminal output

```ts
new ConsoleLog({
  showContext: false,      // default — context is dropped on console
  contextDepth: 4,         // util.inspect depth, when showContext is true
  // BasicLogConfigurations:
  levels: ["info", "warn", "error"],   // per-channel level filter
  filter: (data) => !data.message.includes("noisy"),
  redact: { paths: ["context.token"], censor: "[REDACTED]" },
});
```

Each line is prefixed with the level's icon and name, in a per-level color: `⚙ debug`, `ℹ info`, `✓ success`, `⚠ warn`, `✗ error`, `☠ fatal`. Best for development; in production, prefer a structured channel.

`showContext: true` is gold in dev — you get the full context object pretty-printed below the message. Production logs usually skip this and rely on JSONFileLog instead.

### FileLog — human-readable persistent logs

Writes entries to a file in the same format the console prints (minus the ANSI colors — the framework strips them before non-terminal channels). Good for tailing in production when you don't have a log aggregator.

### JSONFileLog — structured logs

Writes a single pretty-printed (2-space indented) JSON document of shape `{ messages: [ ... ] }` — each new batch is appended into the `messages` array. Every record is `{ content, level, date, module, action, stack?, context?, timestamp }` — note the message text lives under `content`, not `message`. This is an array-wrapped indented document, not newline-delimited JSON, so it isn't ingested line-by-line by tools like Datadog/Splunk/Loki/ELK without a parser. Pair with log rotation (`rotate: true`) and a forwarder.

## The call signature

All five level methods share the same shape:

```ts
log.info(module: string, action: string, message: any, context?: Record<string, any>);
log.warn(module, action, message, context?);
log.error(module, action, message, context?);
log.success(module, action, message, context?);
log.debug(module, action, message, context?);
```

Or as a single object:

```ts
log.info({ module: "auth", action: "login", message: "ok", context: { userId } });
```

The four-positional form is the dominant one in the reference codebase — it stays readable in grep output and feels symmetric across levels.

**Real-world examples** from the framework and `src/app/`:

```ts
log.info("auth", "login", "Session created", { userId, deviceId });
log.success("upload", "stored", `Uploaded ${result.path}`, { size, mime });
log.warn("cache", "stale", "Returning stale value, refresh failed", { key, age });
log.error("ai-usage", "create", "Failed to record usage", { runId, error });
log.debug("router", "dispatch", `${method} ${path}`, { duration });
```

The convention from the reference codebase: define `LOG_MODULE = "domain.action"` at the top of services and use it as the first arg — keeps the module label consistent across a file.

## Assertions and timers

Two convenience helpers on the logger:

```ts
log.assert(condition, "auth", "session", "User vanished mid-flight", { sessionId });
// → no-op if condition is truthy; logs `error` if falsy
```

`assert` is genuinely free in the happy path — the entry is never built and channels are not invoked.

```ts
const end = log.timer("db", "users.findById");
const user = await usersRepo.findById(id);
end({ id, found: !!user });
// → "completed in 42ms" with durationMs: 42 in context
```

`timer` returns a function. Call it with optional extra context fields when the work is done; it logs `info` with `durationMs` baked in.

## Redaction

The most underrated feature. Strip sensitive paths from every log entry before any channel sees them. Configure once, applies everywhere.

```ts
log.setRedact({
  paths: ["context.password", "context.*.token", "context.headers.authorization"],
  censor: "[REDACTED]",
});
```

Path syntax:

- `context.password` — exact key
- `context.*.token` — wildcard one segment (matches `context.user.token`, `context.admin.token`)
- `context.**` — match any depth

The redaction floor is logger-wide. Channels can extend the path list (additive) — they cannot remove paths. An attacker who configures a channel can't undo the logger's redaction.

Channel-level redaction:

```ts
new ConsoleLog({
  redact: {
    paths: ["context.email"],   // adds to the logger-wide list
    censor: "[hidden]",          // overrides the censor for this channel
  },
});
```

`censor` can be a string (`"[REDACTED]"`) or a function:

```ts
log.setRedact({
  paths: ["context.email"],
  censor: (value, path) => {
    if (typeof value !== "string") return "[REDACTED]";
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  },
});
// log.info("auth", "ok", "...", { email: "hassan@example.com" })
// → context.email is "ha***@example.com" in every channel
```

## Per-channel filtering

Each channel inherits `BasicLogConfigurations`:

```ts
type BasicLogConfigurations = {
  levels?: LogLevel[];                              // accept only these levels
  dateFormat?: { date?: string; time?: string };
  filter?: (data: LoggingData) => boolean;          // custom predicate
  context?: (data: LoggingData) => Promise<Record<string, any>>;  // enrich
  redact?: RedactConfig;                            // additive on top of logger floor
};
```

Use `levels` to scope a channel (e.g. console gets everything, file gets warn+error only). Use `filter` for content-aware exclusions ("drop healthcheck logs"). Use `context` to enrich entries before they hit the channel ("add the current request id to every entry").

## Auto-flush on shutdown

For buffered channels (FileLog, JSONFileLog), you want pending entries to flush when the process exits. Configure with `autoFlushOn`:

```ts
log.configure({
  channels: [consoleLog, jsonFileLog],
  autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
});
```

The framework registers process-level handlers. For signal events (`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`, `SIGUSR2`), the handler flushes, unregisters itself, and re-raises the signal so Node's default exit behavior runs. For `beforeExit` it just flushes — Node exits naturally afterwards.

Skip this in dev (Ctrl-C is fast enough), use it in production where you don't want to lose the last batch on a graceful restart.

## Bootstrap hook — unhandled rejections

The framework's bootstrap installs `captureAnyUnhandledRejection` — unhandled promise rejections get logged at `error` level via the same `log` singleton, and the process keeps running. You don't need to wire this up; it's already there. An **uncaught exception** is logged at `fatal` and, in production, takes the process down with a non-zero exit so a fatal boot/runtime crash is never silently swallowed into `exit 0`; in dev it's logged and the server keeps running so HMR can recover.

## Common patterns

### Per-service log module constant

The reference codebase convention — define `LOG_MODULE` once, use it everywhere in the file:

```ts title="src/app/ai-usage/services/create-ai-usage.service.ts"
import { log } from "@warlock.js/logger";

const LOG_MODULE = "ai-usage";

export async function createAiUsageService(event: UsageEvent, context: CreateAiUsageContext) {
  log.info(LOG_MODULE, "create", "Creating ai_usage row", {
    runId: event.runId,
    tripIndex: event.tripIndex,
    model: event.model.name,
    provider: event.model.provider,
  });

  try {
    // ... do work ...
    log.success(LOG_MODULE, "create", "Created ai_usage row", {
      id: row.uuid,
      runId: event.runId,
    });
  } catch (err) {
    log.error(
      LOG_MODULE,
      "create",
      `Failed to create ai_usage row: ${err instanceof Error ? err.message : String(err)}`,
      {
        error: err,
        runId: event.runId,
        organizationId: context.organizationId,
      },
    );
  }
}
```

The pattern reads like a transcript — start, success, failure with the same `module` and `action`. Grep `LOG_MODULE` and `action` to trace a single operation across the codebase.

### Production-quiet, dev-verbose

```ts title="src/config/log.ts"
const logConfigurations: LogConfigurations = {
  development: {
    channels: [new ConsoleLog({ showContext: true })],   // debug-friendly
  },
  production: {
    channels: [
      new ConsoleLog({ levels: ["info", "success", "warn", "error"] }),  // drop debug
      new JSONFileLog({ storagePath: "/var/log/app", rotate: true }),
    ],
  },
};
```

Pair with `log.setMinLevel("info")` in production bootstrap if you want to drop debug entries before they reach any channel — cheaper than the per-channel filter.

### Redact request bodies in production

```ts title="src/main.ts (or a bootstrap step)"
log.setRedact({
  paths: [
    "context.password",
    "context.*.password",
    "context.headers.authorization",
    "context.headers.cookie",
    "context.body.creditCard",
  ],
  censor: "[REDACTED]",
});
```

Now every log entry — across every channel — has those paths censored before anything writes them to disk or the wire.

### Timer wrapping a database call

```ts
async function findUserCached(id: string) {
  const end = log.timer("users", "findById");

  try {
    const user = await usersRepository.first({ id });
    end({ id, found: !!user });
    return user;
  } catch (error) {
    end({ id, error: (error as Error).message });
    throw error;
  }
}
```

The timer always logs — even on error — so you get both the happy-path timing and a record of the failures.

## Gotchas

- **`log` is a `Logger` instance, not a callable.** `log("module", ...)` doesn't work — it's `log.info(...)`, `log.error(...)`, etc. The bare callable form was removed when the dual `log` / `logger` exports were collapsed into one name.
- **`showContext` is per-channel.** It defaults to `false` on `ConsoleLog`, which means context is silently dropped from terminal output. Persistent channels (`FileLog`, `JSONFileLog`) always retain it. Turn `showContext: true` on in dev or you'll wonder where your context fields went.
- **Channels see a shallow clone.** Each channel receives its own copy of the entry — one channel cannot mutate the payload another channel sees. That's by design; don't rely on cross-channel mutation.
- **ANSI colors are stripped for non-terminal channels.** The framework calls `clearMessage` for any channel with `terminal === false`. Color codes in your messages won't pollute file logs.
- **Redaction is additive.** A channel can only redact more than the logger floor — never less. You can't open a hole.
- **Auto-flush doesn't re-raise `beforeExit`.** Only signal events are re-raised. `beforeExit` flushes in place; Node exits on its own.
- **Min-level filter is logger-wide.** If you want one channel to accept debug but another to drop it, leave `log.setMinLevel(undefined)` and use `levels: ["info", "warn", "error"]` per-channel.
- **`log.assert(condition, ...)` is free on truthy conditions.** No string formatting runs, no channel is called. Cheap to use liberally.
- **`enabled` and `test` in `src/config/log.ts` are inert.** The core `setLogConfigurations()` wrapper only reads `channels` plus the `development`/`production` env blocks' `channels`. `enabled: false` does not disable anything, and a `test:` block is never consulted (under test, only top-level `channels` apply). To turn logging off, ship an empty `channels` list or filter per-channel with `levels`.

## See also

- **[Configuration](../architecture-concepts/configuration-deep.md)** — the `src/config/log.ts` shape and how env-specific blocks compose.
- **[Bootstrap and connectors](../architecture-concepts/bootstrap-and-connectors.md)** — where the logger is wired into the bootstrap sequence and `captureAnyUnhandledRejection` lives.
- **[`@warlock.js/logger`](/v/latest/logger/)** — the underlying package, for custom channels and redact-config patterns beyond the warlock surface.
