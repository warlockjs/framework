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

`warlock upgrade --from 5.29 --to 5.31.0` applies the same edit across an app
(the codemod belongs to 5.30, so `--from` names the release before it).

## Options

`loggerNames` — identifiers that are the logger (default `["log", "logger"]`).
