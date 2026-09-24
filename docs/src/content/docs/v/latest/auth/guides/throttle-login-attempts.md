---
title: "Throttle login attempts"
description: Brute-force protection with loginThrottleMiddleware — failure-aware counting, per-account and per-IP lockout, exact counts across servers.
sidebar:
  order: 9
  label: "Throttle login attempts"
---

`loginThrottleMiddleware()` defends login, refresh and password-reset routes against brute-force and credential stuffing. It counts only **failed** attempts, clears the counter when a login succeeds, and rejects a locked request with `429` (`AuthErrorCodes.TooManyAttempts`, `EC004`) before the controller — and the bcrypt verify — ever runs.

```ts
import { loginThrottleMiddleware } from "@warlock.js/auth";

router.post("/auth/login", loginController, {
  middleware: [loginThrottleMiddleware()], // 5 failures / 15m → 15m lockout, per email + ip
});
```

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `max` | `5` | Failures within the window before lockout |
| `window` | `"15m"` | Counting window (`ms`-string or seconds) |
| `lockoutDuration` | `"15m"` | How long the lock lasts once tripped |
| `by` | `["email", "ip"]` | Identifiers tracked, each independently |
| `identifierKey` | `"email"` | Credential field used as the account key |
| `errorMessage` | i18n `auth.errors.tooManyAttempts` | 429 message override |
| `isFailure` | `(res) => !res.isOk` | What counts as a failed attempt |
| `identify` | built-in email + ip extraction | Custom identifier list |

## How failures are counted

After the controller responds, a non-2xx response counts as a failure for each tracked identifier:

1. The first failure opens the window with a create-only cache write that carries the TTL. An existing window keeps its deadline, so the window is fixed, not sliding.
2. The counter is bumped with an atomic `cache.increment`.
3. When the count reaches `max`, a lock key is written for `lockoutDuration`.

Because the bump is atomic, concurrent failures on different servers are never lost: on the **redis** and **pg** cache drivers the counts are exact across every instance. A 2xx response clears the counter and the lock.

:::caution
The **memory** cache driver is per-process. With it, counts and locks are per instance, so an attacker spreading attempts across servers gets `max` tries on each. Use redis or pg when you run more than one instance.
:::

## Fails open

Storage is `@warlock.js/cache`. If the cache driver is unavailable the middleware logs the error and lets the request through — a throttle outage must never become an auth outage. That also means no cache, no protection.

## Related

- [Handle login and logout](./handle-login-and-logout.md) — the flow whose failures this counts.
- [Protect routes](./protect-routes.md) — stack the throttle in front of `authMiddleware` where needed.
- [Verify email and reset password](./verify-email-and-reset-password.md) — presets that wrap `loginThrottleMiddleware`.
