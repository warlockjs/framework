---
title: "Types"
description: "Every exported type — LogLevel, LoggingData, RedactConfig, AutoFlushEvent, and friends."
sidebar:
  order: 4
  label: "Types"
---

Every type exported from `@warlock.js/logger`.

## `LogLevel`

The six severity levels.

```ts
type LogLevel = "debug" | "info" | "warn" | "error" | "success" | "fatal";
```

`success` ranks the same as `info` — it's informational, not a warning. `fatal` is strictly above `error` — use it for unrecoverable failures where the app is going down (failed bootstrap, `uncaughtException`). Ranking for `minLevel`: `debug < info ≈ success < warn < error < fatal`.

## `LoggingData`

The entry passed through `log.log(...)` and to every channel's `log()`.

```ts
type LoggingData = {
  type: LogLevel;
  module: string;
  action: string;
  message: any;
  context?: Record<string, any>;
};
```

## `OmittedLoggingData`

`LoggingData` without `type` — the object form accepted by the per-level shortcuts (`log.info({...})`), where the level is implied by the method.

```ts
type OmittedLoggingData = Omit<LoggingData, "type">;
```

## `LogMessage`

The serialized shape stored by the file channels (one per buffered entry).

```ts
type LogMessage = {
  content: string;
  level: LogLevel;
  date: string;
  module: string;
  action: string;
  stack?: string;
  context?: Record<string, any>;
  timestamp?: string;
};
```

## `LogContract`

The interface a channel must satisfy. `LogChannel` already implements it.

```ts
interface LogContract {
  name: string;
  description?: string;
  terminal?: boolean;
  log(data: LoggingData): void | Promise<void>;
  flushSync?(): void;
}
```

## `BasicLogConfigurations`

The shared options every built-in channel config extends.

```ts
type BasicLogConfigurations = {
  /** Restrict which levels this channel handles. Omit for all levels. */
  levels?: LogLevel[];
  /** Day.js format strings for the date/time in each entry. */
  dateFormat?: {
    date?: string;
    time?: string;
  };
  /** Predicate to decide whether an entry should be logged. */
  filter?: (data: LoggingData) => boolean;
  /** Add extra context to the entry. */
  context?: (data: LoggingData) => Promise<Record<string, any>>;
  /** Channel-specific redaction — additive on top of the logger-wide floor. */
  redact?: RedactConfig;
};
```

## `AutoFlushEvent`

The process events `enableAutoFlush()` can hook.

```ts
type AutoFlushEvent =
  | "SIGINT"
  | "SIGTERM"
  | "SIGHUP"
  | "SIGBREAK"
  | "SIGUSR2"
  | "beforeExit";
```

Signals are flushed then re-raised so Node's default exit runs; `beforeExit` is flushed in place. See [Shutdown & flushing](../advanced/03-shutdown-and-flushing/).

## `RedactConfig`

```ts
type RedactConfig = {
  /** Dotted glob path patterns to redact, evaluated against LoggingData. */
  paths: string[];
  /** Replacement applied at each match. @default "[REDACTED]" */
  censor?: RedactCensor;
};
```

## `RedactCensor`

```ts
type RedactCensor =
  | string
  | ((value: any, path: string) => any);
```

A literal string replaces every match; a function receives the original value plus the dotted path and returns the replacement. See [Redaction](../advanced/01-redaction/).

## `DebugMode`

```ts
type DebugMode = "daily" | "monthly" | "yearly" | "hourly";
```
