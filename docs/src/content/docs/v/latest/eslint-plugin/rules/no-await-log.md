---
title: no-await-log
description: Disallow await on synchronous log calls.
sidebar:
  order: 6
---

**Recommended:** warn · **Fix:** autofix

Since 5.30, `log.info/warn/error/debug/success/fatal/log/assert` return the
logger synchronously. `await` on them only adds a microtask and suggests that
the entry has been delivered, which it has not. To wait for delivery, call
`await log.flush()`.

## Incorrect

```ts
await log.info("auth", "login", "Signed in");
```

## Correct

```ts
log.info("auth", "login", "Signed in");
await log.flush({ timeout: 3_000 }); // only where delivery must finish, e.g. shutdown
```

`warlock upgrade --to 5.31` applies the same edit across an app.

## Options

`loggerNames` — identifiers that are the logger (default `["log", "logger"]`).
