---
title: "Protect routes"
description: Gate HTTP routes with authMiddleware — required auth, any-authenticated vs user-type restriction, route groups.
sidebar:
  order: 3
  label: "Protect routes"
---

`authMiddleware(allowedUserType: string | string[])` returns a Warlock middleware. Attach it to routes or route groups. The argument is **required** — there is no optional/anonymous mode. A request without a valid access token is always rejected with `401`; routes that should be public simply omit the middleware.

## The two modes

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

// Mode 1 — required, any user type
//   401s if no valid token. Empty array = "any logged-in user."
router.get("/account", accountController, { middleware: [authMiddleware([])] });

// Mode 2 — required, specific user types
//   401s if no token, or if the token's user type isn't in the allowed list.
router.get("/admin", adminController, { middleware: [authMiddleware("admin")] });
router.get("/back-office", backOfficeController, { middleware: [authMiddleware(["admin", "staff"])] });
```

Middleware is attached through the route's `options.middleware` array — the third argument — not as a positional argument.

The user-type slug must match a key in `config.auth.userType.<slug>` — see [Customize user type](./customize-user-type.md).

## What the middleware does on success

Before your controller runs:

```ts
request.user = <hydrated user model instance>;
request.decodedAccessToken = <decoded JWT payload>;
```

The user is loaded via `Model.find(decoded.id)` against the model class registered under the token's `userType`. If the user no longer exists (deleted account), the access-token row is destroyed and the request 401s.

## What it does on failure

| Error code | When |
| --- | --- |
| `MissingAccessToken` (`EC001`) | No `Authorization` header |
| `InvalidAccessToken` (`EC002`) | Token doesn't verify — signature, expired, doesn't match the DB row, user gone |
| `Unauthorized` (`EC003`) | Token valid but user-type isn't in the allowed list |

The response shape (via `response.unauthorized`):

```json
{ "error": "...localized message...", "errorCode": "EC001" }
```

The error code is from the `AuthErrorCodes` enum — handy for the frontend to switch on without parsing the message.

## Reading the user in a controller

```ts
import type { Request, Response } from "@warlock.js/core";

async function accountController(request: Request, response: Response) {
  const user = request.user!;

  return response.success({
    id: user.id,
    email: user.get("email"),
  });
}
```

Because the middleware always requires a valid token, `request.user` is guaranteed inside any gated controller (the middleware would have 401'd otherwise). The `!` is safe here.

A public route that wants *soft* personalization simply omits the middleware and reads the token itself:

```ts
async function feedController(request: Request, response: Response) {
  const token = request.authorizationValue;

  if (token) {
    return response.success({ feed: await personalizedFeed(token) });
  }

  return response.success({ feed: await publicFeed() });
}
```

## Route-group protection

```ts
router.group({ prefix: "/admin", middleware: [authMiddleware("admin")] }, () => {
  router.get("/users", listUsersController);
  router.post("/users", createUserController);
  router.delete("/users/:id", deleteUserController);
});
```

Every route inside the group is gated — the group's `middleware` array applies to each route in the callback. Cleaner than repeating the middleware per route.

## No optional / fallthrough auth

There is no "hydrate `request.user` if a token is present, otherwise continue" mode. `authMiddleware` always requires a valid token. Public routes leave the middleware off entirely; protected groups apply it once:

```ts
// Public — no middleware
router.get("/feed", feedController);

// Protected
router.get("/account", accountController, { middleware: [authMiddleware([])] });
router.get("/admin",   adminController,   { middleware: [authMiddleware("admin")] });
```

If a public route needs soft personalization, read `request.authorizationValue` yourself in the controller (see [Reading the user in a controller](#reading-the-user-in-a-controller)).

## Custom error responses

The middleware uses `response.unauthorized({...})`. To remap globally — say you want a `code` field in addition to `errorCode`, or a 403 on `Unauthorized` instead of 401 — hook the framework's error transformer to react to the `AuthErrorCodes.*` values. See [HTTP response](../../../core/the-basics/http-response/).

## Reading the decoded payload

```ts
async function adminController(request: Request, response: Response) {
  const decoded = request.decodedAccessToken;
  // decoded.id, decoded.userType, decoded.created_at, plus any custom claims you signed.
}
```

The decoded payload is exactly what was passed to `jwt.generate`. The default shape is `{ id, userType, created_at }`; if you used a custom `payload` on `createTokenPair` / `generateAccessToken`, everything you signed is here.

## Things to avoid

- **Calling `authMiddleware` inside the handler.** It returns a middleware function — call it once per route at registration. Calling it per-request creates a fresh `allowedTypes` array each hit.
- **Manually decoding JWTs.** The middleware did it; the result is on `request.decodedAccessToken`.
- **Trusting client-set `request.user`.** The middleware is the only thing that writes that slot server-side. Client headers don't reach it.
- **Passing an unknown user-type.** `authMiddleware("typo")` 401s every request because the config lookup fails. Smoke-test the wire-up with a real token of each user type.

## Related

- [The auth flow](../essentials/01-the-auth-flow.md) — where the middleware sits in the lifecycle.
- [Customize user type](./customize-user-type.md) — the `config.auth.userType` registry.
- [Handle login and logout](./handle-login-and-logout.md) — where the access token comes from.
