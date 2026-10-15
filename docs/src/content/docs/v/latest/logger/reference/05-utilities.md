---
title: "Utilities"
description: "Standalone utility exports — captureAnyUnhandledRejection, applyRedact, mergeRedact, safeJsonStringify, clearMessage."
sidebar:
  order: 5
  label: "Utilities"
---

Standalone functions exported from `@warlock.js/logger` alongside the `Logger` class and channels.

## `captureAnyUnhandledRejection()`

```ts
function captureAnyUnhandledRejection(
  options?: { exitOnUncaughtException?: boolean },
): void;
```

Attaches process-level listeners: `unhandledRejection` → `log.error("app", ...)` (process kept alive), and `uncaughtException` → `log.fatal("app", ...)` then `process.exit(1)` — restoring the non-zero exit that registering the listener would otherwise suppress, so a fatal crash is never silently swallowed into `exit 0`. Pass `{ exitOnUncaughtException: false }` to log without exiting (e.g. a dev server recovering via HMR); when no terminal channel is configured yet, the fatal path also prints the stack to `console.error`. Call once at startup, after channels are registered. See [Capturing unhandled errors](../advanced/02-capturing-unhandled-errors/) for the gotchas.

## `clearMessage(message)`

```ts
function clearMessage(message: any): any;
```

Strips ANSI escape codes from a string. Non-string values are returned unchanged; only strings containing escape sequences are modified. The logger applies this automatically to entries bound for non-terminal channels (`terminal: false`).

```ts
import { clearMessage } from "@warlock.js/logger";

clearMessage("[32mDeployment succeeded[0m"); // → "Deployment succeeded"
```

## `safeJsonStringify(value, space?)`

```ts
function safeJsonStringify(value: unknown, space?: number): string;
```

JSON-serializes a value through `safe-stable-stringify`, handling circular references, `BigInt`, and repeated references; functions and symbols are dropped (standard JSON behavior). `Error` instances are expanded so the non-enumerable `name` / `message` / `stack` survive (a plain spread would drop them), plus any enumerable props you attached such as `code`. This is what `JSONFileLog` writes through.

## `applyRedact(data, config)`

```ts
function applyRedact(data: LoggingData, config: RedactConfig | undefined): LoggingData;
```

Returns a new `LoggingData` with every path in `config.paths` replaced by `config.censor`. The input is never mutated. No-op (returns the input by reference) when `config` is `undefined` or `paths` is empty. `Date` and `Error` instances are reconstructed; circular references are tolerated. See [Redaction](../advanced/01-redaction/) for path syntax.

## `mergeRedact(base, extra)`

```ts
function mergeRedact(
  base: RedactConfig | undefined,
  extra: RedactConfig | undefined,
): RedactConfig | undefined;
```

Combines two redact configs into one. `paths` are concatenated (duplicates kept); `censor` from `extra` wins, falling back to `base`, then to the default `"[REDACTED]"`. This is how a channel's additive `redact` layers on top of the logger-wide floor.

## See also

- [Redaction](../advanced/01-redaction/) — `applyRedact` / `mergeRedact` in context
- [Capturing unhandled errors](../advanced/02-capturing-unhandled-errors/) — `captureAnyUnhandledRejection` in context
- [Channels Overview](../channels/01-overview/) — where `clearMessage` fits the fan-out
