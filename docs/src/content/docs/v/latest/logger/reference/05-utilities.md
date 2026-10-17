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
function captureAnyUnhandledRejection(options?: { exitOnUncaughtException?: boolean }): void;
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

## `maskEmail(address)` / `maskEmailsInText(text)`

```ts
function maskEmail(address: string): string;
function maskEmailsInText(text: string): string;
```

`maskEmail` keeps the first character and the domain: `member@example.com` → `m***@example.com` (a value without `@` becomes `***`). `maskEmailsInText` masks the addresses it recognises in a string: letters and digits from any script (`jöhn@exämple.de` → `j***@exämple.de`), a local part of up to 64 characters and up to 12 domain labels. Dots are valid in a local part, so in a dotted key the prefix is masked with it: `email.member@example.com` → `e***@example.com`.

It does not recognise quoted local parts (`"john doe"@example.com`), IP-literal domains (`user@[127.0.0.1]`) or percent-encoded addresses (`user%40example.com`); mask those at the call site. Text longer than `MASK_EMAILS_MAX_LENGTH` (16,384 characters) is cut off with a `…[N chars truncated]` marker, so masking a huge cache key or message costs a bounded amount of time.

Use them for addresses inside message strings and cache keys, which key-based redaction cannot reach:

```ts
import { log, maskEmail } from "@warlock.js/logger";

log.info("billing", "invoice", `Invoice sent to ${maskEmail(customer.email)}`);
```

## `escapeLogValue(value, options?)`

```ts
function escapeLogValue(value: unknown, options?: { maxLength?: number }): string;
```

Makes client-controlled text safe inside a log line. CR, LF and tab become the
visible escapes `\r`, `\n`, `\t`; other control characters (NUL, DEL, C1 controls,
U+2028/U+2029) become `\uXXXX`; ANSI escape sequences are removed. Non-strings
are converted with `String()`. With `maxLength`, longer text is cut and ends
with `…[truncated]`.

Without it, a user agent or form field containing a line break writes a forged
entry into console and file logs, and an ANSI sequence can rewrite what a
terminal shows:

```ts
import { escapeLogValue, log } from "@warlock.js/logger";

log.info("auth", "login", `Login from ${escapeLogValue(userAgent, { maxLength: 256 })}`);
```

## See also

- [Redaction](../advanced/01-redaction/) — `applyRedact` / `mergeRedact` in context
- [Capturing unhandled errors](../advanced/02-capturing-unhandled-errors/) — `captureAnyUnhandledRejection` in context
- [Channels Overview](../channels/01-overview/) — where `clearMessage` fits the fan-out
