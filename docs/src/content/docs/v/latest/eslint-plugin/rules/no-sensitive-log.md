---
title: no-sensitive-log
description: Disallow logging raw emails, credentials and request bodies outside the redaction helpers.
sidebar:
  order: 4
---

**Recommended:** error

Logs are kept longer, copied to more places and read by more people than the
database. The rule reports, in `log.*`, `logger.*`, `console.*` and
`request.log()` calls:

- whole request bodies, headers and cookies (`request.all()`, `request.body`,
  `request.validated()`, `request.headers`, …);
- emails (`user.email`, `request.input("email")`, `{ email }`);
- credentials — names ending in `token`, `password`, `secret`, `apiKey`,
  `authorization`, `cookie`, `otp`, `jwt` — in message text or under a key the
  logger does not censor.

A value passed through a redaction helper is fine: `maskEmail()`,
`maskEmailsInText()`, `redact()`, `redactHeaders()`, `redactError()`,
`redactUrlCredentials()`, `redactQueryCredentials()`, `escapeLogValue()` and
`request.toLogSnapshot()`. Credentials logged as structured data under a key
the logger censors by default (`token`, `password`, `apiKey`, `authorization`,
`cookie`, … — the logger's `DEFAULT_REDACT_KEYS`) are fine too. Emails are not
censored by default, so they always need `maskEmail()`.

## Incorrect

```ts
log.info("auth", "login", `Signed in ${user.email}`);
log.debug("auth", "token", "Issued " + accessToken);
log.info("posts", "create", "Input", request.all());
```

## Correct

```ts
import { log, maskEmail } from "@warlock.js/logger";

log.info("auth", "login", `Signed in ${maskEmail(user.email)}`, { userId: user.id });
log.debug("auth", "token", "Issued", { token: accessToken });
log.info("http", "request", request.url, { request: request.toLogSnapshot() });
```

## Options

`requestNames`, `loggerNames` (default `["log", "logger", "console"]`) and
`redactors` (helpers whose arguments are not inspected).
