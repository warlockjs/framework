---
title: "Protect routes"
description: Gate HTTP routes with authMiddleware — required auth, any-authenticated vs user-type restriction, route groups.
sidebar:
  order: 3
  label: "Protect routes"
---

`authMiddleware` returns a Warlock middleware. It has typed/default hard-gate forms plus an object form for one credential source, optional resolution, and a page-local redirect. Legacy `authMiddleware(userType, "cookie:name")` remains supported.

Use `{ source: "header" }` (the default) or `{ source: "cookie", key: "access_token" }` to select one credential source.

## Common forms

Middleware belongs in the route `options.middleware` array.

```ts
router.get("/account", accountController, {
  middleware: [authMiddleware()], // configured default user type
});

router.get("/admin", adminController, {
  middleware: [authMiddleware("admin")],
});

router.get("/feed", feedController, {
  middleware: [authMiddleware({ source: "cookie", key: "access_token", optional: true })],
});

router.get("/profile", profileController, {
  middleware: [authMiddleware("user", {
    source: "cookie",
    key: "access_token",
    redirect: { to: "/login", returnUrlParam: "return_to" },
  })],
});
```

`authMiddleware()` uses `auth.defaultUserType`; with several configured user
classes and no default, it throws during setup instead of guessing. `optional:
true` permits anonymous continuation only. A presented credential is still
fully verified and hydrates `request.locals.user` when valid. The legacy
`authMiddleware("user", "cookie:access_token")` form remains valid.
## Automatic cookie renewal

Opt in on a route with one allowed user type and both cookie descriptors:

```ts
router.get("/account", accountController, {
  middleware: [authMiddleware("user", {
    source: "cookie",
    key: "access_token",
    refresh: { source: "cookie", key: "refresh_token", overlapMs: 5000 },
    redirect: { to: "/login", returnUrlParam: "return_to" },
  })],
});
```

Missing or expired access credentials can be renewed once before the handler
runs. Both replacement cookies are written using the configured cookie policy;
the handler and mutations are never replayed. Run the additive `authMigrations`
before enabling renewal.

Concurrent requests presenting the same refresh token may receive its exact
immediate active successor during a bounded duplicate window: five seconds by
default, clamped to zero through ten seconds. A later rotated successor is never
substituted. Outside that window, old-token reuse revokes the family. The public
`authService.refreshTokens()` API retains strict replay handling. Family logout
invalidates the persisted credentials even if an older response later sets a
cookie; arbitrary out-of-order cookie delivery across generations is not solved
by this mechanism.

The local `redirect` applies only to page-route authentication failures. API
requests retain status responses; authenticated disallowed user types get 403.

## What the middleware does on success

Before your controller runs:

```ts
request.locals.user = <hydrated user model instance>;
request.decodedAccessToken = <decoded JWT payload>;
```

The user is loaded via `Model.find(decoded.id)` against the model class registered under the token's `userType`. If the user no longer exists (deleted account), the access-token row is destroyed and the request 401s.

## What it does on failure

| Error code                     | When                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `MissingAccessToken` (`EC001`) | No credential at the configured source (401)                                   |
| `InvalidAccessToken` (`EC002`) | Token doesn't verify — signature, expired, doesn't match the DB row, user gone |
| `Unauthorized` (`EC003`)       | Token valid but user-type isn't in the allowed list (403)                      |

The response shape (via `response.unauthorized`):

```json
{ "error": "...localized message...", "errorCode": "EC001" }
```

The error code is from the `AuthErrorCodes` enum — handy for the frontend to switch on without parsing the message.

## Reading the user in a controller

```ts
import type { RequestHandler } from "@warlock.js/core";

const accountController: RequestHandler = async ({ request, response }) => {
  const user = request.locals.user!;

  return response.success({
    id: user.id,
    email: user.get("email"),
  });
};
```

In a hard-gated controller, `request.locals.user` is guaranteed. With `optional: true`, check it before using it. 

## Route-group protection

```ts
router.group({ prefix: "/admin", middleware: [authMiddleware("admin")] }, () => {
  router.get("/users", listUsersController);
  router.post("/users", createUserController);
  router.delete("/users/:id", deleteUserController);
});
```

Every route inside the group is gated — the group's `middleware` array applies to each route in the callback. Cleaner than repeating the middleware per route.

## Cookie-sourced credentials

**New in 5.12.** Pass `` `cookie:${name}` `` as the second argument to read the credential from a cookie instead of the `Authorization` header:

```ts
router.get("/account", accountController, {
  middleware: [authMiddleware({ source: "cookie", key: "access_token" })],
});
```

Nothing writes that cookie for you implicitly — pair it with `authService.setAuthCookie` / `clearAuthCookie` in your login/logout controllers (see [Handle login and logout](./handle-login-and-logout.md#cookie-based-sessions--setauthcookie--clearauthcookie)). Upgrading never starts a bearer-only app emitting `Set-Cookie` on its own.

## Automatic cookie renewal

The 5.19 `refresh` descriptor is opt-in and is being reconciled with the final
durable coordinator. Its release contract is narrow: only an exact immediately
active successor pair may be reused during the configured duplicate window
(default five seconds, range zero through ten). The strict legacy
`authService.refreshTokens` path remains unchanged. A tolerated duplicate is a
security tradeoff, not general replay acceptance; later old-token reuse revokes
the family, and family logout invalidates late cookies. It does not solve
arbitrary out-of-order HTTP cookie delivery.
## CSRF Origin check for cookie auth

**New in 5.12.** A cookie-sourced credential can be silently replayed cross-site by a browser (a same-site `GET` redirect chain, or a client that ignores `SameSite`) in a way a header token cannot — nothing but your own JS can attach an `Authorization` header, but a browser attaches cookies automatically. To close that gap, `authMiddleware` automatically runs a CSRF Origin check whenever **both** are true:

- the credential came from a `cookie:` source (not `"header"`), and
- the request method is unsafe (`POST` / `PUT` / `PATCH` / `DELETE`).

`GET` / `HEAD` / `OPTIONS` and header-token auth are never checked — only the cookie + unsafe-method combination is in scope.

The check passes when `Origin` — or, if `Origin` is absent, `Referer` — names the request's own origin (scheme + host) or an entry in `auth.csrf.allowedOrigins` (default `[]`, configured in [`src/config/auth.ts`](../getting-started/03-configuration.mdx#csrfallowedorigins--new-in-512)). A request that carries **neither** header is rejected too — the check fails closed, not open.

A failure is a `403` with `AuthErrorCodes.CsrfOriginMismatch` (`EC006`):

```json
{ "error": "...localized message...", "errorCode": "EC006" }
```

```ts title="src/config/auth.ts"
import type { AuthConfigurations } from "@warlock.js/auth";

const authConfig: AuthConfigurations = {
  // ...
  csrf: {
    allowedOrigins: ["https://admin.example.com"],
  },
};

export default authConfig;
```

This closes the residual CSRF gap that `SameSite=Lax` alone leaves open for cookie auth. It's not a full double-submit-token mechanism — that's deferred to a later release — but it stops the common cross-site cookie-replay case outright, and it costs nothing on header-token routes.

## Default CSRF-Origin guard (applies with or without `authMiddleware`)

**New in 5.17.** The check above only ever ran inside `authMiddleware("cookie:*")` — a cookie-authenticated write reaching any *other* path (an app-owned optional-auth pattern that reads its own `token` cookie directly, without ever calling `authMiddleware`) was never checked at all.

`@warlock.js/core` now runs the same Origin/Referer check at the earliest HTTP seam, before route middleware and before any app handler, for **every** request where:

- the method is `POST` / `PUT` / `PATCH` / `DELETE`, and
- the request carries a `Cookie` header naming anything other than the framework's own `locale` cookie (a `Cookie` header that fails to parse cleanly counts as carrying one — it fails closed), and
- the route hasn't opted out (below).

It reuses the exact same same-origin / `auth.csrf.allowedOrigins` comparison and the same `403` / `AuthErrorCodes.CsrfOriginMismatch` (`EC006`) response as the `authMiddleware` check above, so the two never disagree. A header-only API request (no `Cookie` header at all, e.g. `Authorization: Bearer …`) is completely unaffected, and a route already covered by `authMiddleware("cookie:*")` is not checked twice or logged twice — the earlier guard short-circuits the request before that middleware runs.

### Exempting a route — `{ csrf: false }`

⚠️ **Dangerous.** Only exempt a route that cannot present a same-origin `Origin`/`Referer` by construction and is safe without this check — a third-party callback the browser is redirected to directly, or a machine-to-machine route no browser ever calls with cookies. Never exempt a route an ordinary signed-in browser session writes to.

```ts
router.post("/oauth/callback", oauthCallbackController, { csrf: false });
```

## No optional / fallthrough auth

There is no "hydrate `request.locals.user` if a token is present, otherwise continue" mode. `authMiddleware` always requires a valid token. Public routes leave the middleware off entirely; protected groups apply it once:

```ts
// Public — no middleware
router.get("/feed", feedController);

// Protected
router.get("/account", accountController, { middleware: [authMiddleware([])] });
router.get("/admin", adminController, { middleware: [authMiddleware("admin")] });
```

If a public route needs soft personalization, read `request.authorizationValue` yourself in the controller (see [Reading the user in a controller](#reading-the-user-in-a-controller)).

## Custom error responses

The middleware uses `response.unauthorized({...})`. To remap globally — say you want a `code` field in addition to `errorCode`, or a 403 on `Unauthorized` instead of 401 — hook the framework's error transformer to react to the `AuthErrorCodes.*` values. See [HTTP response](../../../core/the-basics/http-response/).

## Reading the decoded payload

```ts
import type { RequestHandler } from "@warlock.js/core";

const adminController: RequestHandler = async ({ request, response }) => {
  const decoded = request.decodedAccessToken;
  // decoded.id, decoded.userType, decoded.created_at, plus any custom claims you signed.
};
```

The decoded payload is exactly what was passed to `jwt.generate`. The default shape is `{ id, userType, created_at }`; if you used a custom `payload` on `createTokenPair` / `generateAccessToken`, everything you signed is here.

## Things to avoid

- **Calling `authMiddleware` inside the handler.** It returns a middleware function — call it once per route at registration. Calling it per-request creates a fresh `allowedTypes` array each hit.
- **Manually decoding JWTs.** The middleware did it; the result is on `request.decodedAccessToken`.
- **Trusting client-set `request.locals.user`.** The middleware is the only thing that writes that slot server-side. Client headers don't reach it.
- **Passing an unknown user-type.** `authMiddleware("typo")` 401s every request because the config lookup fails. Smoke-test the wire-up with a real token of each user type.

## Related

- [The auth flow](../essentials/01-the-auth-flow.md) — where the middleware sits in the lifecycle.
- [Customize user type](./customize-user-type.md) — the `config.auth.userType` registry.
- [Handle login and logout](./handle-login-and-logout.md) — where the access token comes from.
