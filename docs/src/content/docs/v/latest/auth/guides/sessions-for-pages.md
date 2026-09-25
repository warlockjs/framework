---
title: "Sessions for pages"
description: pageSession, the refresh cookie, session lifetime, header-over-cookie precedence, login Origin check and multi-instance rules.
sidebar:
  order: 12
  label: "Sessions for pages"
---

`pageSession()` resolves a request's credential to a user for `@warlock.js/web` pages (`web.session`). `sessionMiddleware()` gives cookie API routes the same resolver.

```ts
import { pageSession, sessionMiddleware } from "@warlock.js/auth";

export default { session: pageSession({ project: (user: User) => userSessionResource(user) }) };

// cookie API route
router.get("/me", handler, { middleware: [sessionMiddleware({ optional: true })] });
```

## Options

| Option | Default |
|---|---|
| `project` (`pageSession` only, required) | none |
| `cookie` | `auth.cookie.name` (`access_token`) |
| `refreshCookie` | `auth.cookie.refreshName` (`refresh_token`) |
| `sources` | `["cookie", "header"]` |
| `renew` | `true` (cookie source only) |
| `userTypes` | `auth.defaultUserType`; renewal needs exactly one |
| `maxAge` | `auth.session.maxAge`, else `"30d"` |
| `overlapMs` | renewal default (5 s, capped at 10 s) |

`sessionMiddleware` also takes `optional` (guests pass with no user instead of a 401) and puts the user on `request.locals.user`.

## Cookies and lifetime

Set both cookies with `authService.setSessionCookies(response, tokens)` and clear them with `authService.clearSessionCookies(response)`. They are `HttpOnly`, `SameSite=Lax`, `Path=/` and `Secure` outside development. The refresh cookie must be `Path=/` so it reaches every page.

`maxAge` caps the family's absolute age. Rotation never extends a family past it; an older family is revoked. Renewal is reactive (on an expired or missing access cookie), not proactive, and there is no remember-me switch.

## Header over cookie

A present `Authorization` header always wins and never falls back to the cookie, even when it is invalid. Renewal applies only to the cookie source.

CSRF: a cookie-authenticated unsafe request must pass the Origin/Referer check (`auth.csrf.allowedOrigins` adds origins). `sessionMiddleware` runs it whenever an access or refresh cookie is present, since renewal can mint cookies. Header-authenticated requests skip it.

## Login needs an Origin

```ts
const result = await authService.loginWithSessionCookies(request, response, User, credentials);
```

It checks Origin (or Referer) before looking at credentials, even when the request has no cookies (login CSRF). A missing or cross-site Origin throws `CsrfOriginMismatchError`. It returns `null` for bad credentials and sets both cookies on success.

## Multi-instance

Nothing is held in process memory; renewal serialises in the database. Share:

- **The JWT secret**, identical on every instance.
- **The cache store** used by the login throttle: use a shared driver (for example Redis), or each instance counts alone. The throttle fails open.
- **Synchronised clocks (NTP)**: the renewal overlap check compares `Date.now()` with `revoked_at`; skew above about 5 s can read a concurrent renewal as a replay and sign the user out.

Logout is immediate everywhere because the access-token row is checked per request. Core `rateLimit` stays per-process.
