---
title: "Handle login and logout"
description: Build POST /login and POST /logout via authService.login and authService.logout — credentials, device info, the no-refresh-token fail-safe.
sidebar:
  order: 2
  label: "Handle login and logout"
---

`authService` exposes the full flow. Pass the model class so the service knows which user-type to look up.

## Login — `authService.login(Model, credentials, deviceInfo?)`

```ts title="src/app/users/controllers/login.controller.ts"
import { authService } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";
import { User } from "../models/user.model";

export async function loginController(request: Request, response: Response) {
  const result = await authService.login(
    User,
    {
      email: request.input("email"),
      password: request.input("password"),
    },
    {
      userAgent: request.header("user-agent"),
      ip: request.ip,
    },
  );

  if (!result) {
    return response.unauthorized({ error: "Invalid credentials" });
  }

  return response.success(result);
}
```

The returned shape:

```ts
{
  user: T,                // your User subclass, hydrated
  tokens: {
    accessToken:  { token: string, expiresAt: string },
    refreshToken?: { token: string, expiresAt: string },  // omitted if refresh is disabled
  },
}
```

Returns `null` on a miss (wrong password, user not found). Map that to a 401 — never tell the client *which* part failed.

## What `credentials` looks like

The shape is arbitrary. Every key except `password` becomes a `where(...)` filter on `Model.first(...)`. The `password` field is bcrypt-compared against the user's stored hash.

```ts
// Email + password
authService.login(User, { email, password });

// Username + password
authService.login(User, { username, password });

// Phone + hashed OTP (OTP becomes the "password" for this login attempt)
authService.login(User, { phone, password: hashedOTP });
```

This means "any combination of lookup keys works" — no special-case code for phone vs email vs username vs anything you add later.

## Lower-level — just verify, don't issue

`authService.attemptLogin(Model, credentials)` is the verification step alone. Returns the user or null. Use it when you want to gate the actual token issuance behind something else (MFA, email confirmation, IP check):

```ts
const user = await authService.attemptLogin(User, { email, password });

if (!user) {
  return response.unauthorized({ error: "Invalid credentials" });
}

if (!isMfaVerified(request)) {
  return response.success({ next: "mfa", userId: user.id });
}

const tokens = await user.createTokenPair({ userAgent, ip });
return response.success({ user, tokens });
```

The static `User.attempt({ email, password })` is a sugary alias for the same call.

## Device info — `DeviceInfo`

Metadata that lands on the refresh-token row:

```ts
authService.login(User, credentials, {
  userAgent: request.header("user-agent"),
  ip: request.ip,
  deviceId: request.input("deviceId"),
});
```

`userAgent` / `ip` / `deviceId` are passed through. `familyId` and `payload` are also accepted but reserved for special cases (continuing an existing rotation chain; custom access-token payload).

## Logout — `authService.logout(user, accessToken?, refreshToken?)`

```ts title="src/app/users/controllers/logout.controller.ts"
import { authService } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";

export async function logoutController(request: Request, response: Response) {
  await authService.logout(
    request.user!,
    request.authorizationValue,
    request.input("refreshToken"),
  );

  return response.success({ message: "Logged out" });
}
```

The contract:

- **Access token passed** → that access-token row is deleted.
- **Refresh token passed** → that refresh-token row is revoked.
- **No refresh token** → behavior depends on `config.auth.jwt.refresh.logoutWithoutToken`:
  - `"revoke-all"` (default) — every refresh token for this user is revoked. Fail-safe.
  - `"error"` — throws. Force the client to send the refresh token.

The `revoke-all` default is right for most apps. If the client lost track of the refresh token, logout still works; the user has to log back in everywhere.

The route itself needs `authMiddleware([])` or `authMiddleware("user")` so `request.user` is hydrated:

```ts title="src/app/users/routes.ts"
router.post("/logout", logoutController, { middleware: [authMiddleware([])] });
```

## Logout from all devices

```ts
await authService.revokeAllTokens(user);
// or, equivalently:
await user.revokeAllTokens();
```

Revokes every refresh token + deletes every access token for this user. Fires `token.revoked` per token + `logout.all` once.

This is the "kick all my sessions" button.

## Refresh tokens — `authService.refreshTokens(refreshTokenString, deviceInfo?)`

```ts title="src/app/users/controllers/refresh.controller.ts"
import { authService } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";

export async function refreshController(request: Request, response: Response) {
  const tokens = await authService.refreshTokens(
    request.input("refreshToken"),
    { userAgent: request.header("user-agent"), ip: request.ip },
  );

  if (!tokens) {
    return response.unauthorized({ error: "Invalid refresh token" });
  }

  return response.success({ tokens });
}
```

Returns a new pair or `null` (token expired, revoked, replay-detected). The endpoint doesn't need `authMiddleware` — the refresh token itself is the credential.

Internals on the rotation flow are covered in [Manage tokens](./manage-tokens.md).

## Auth events for the login/logout cycle

```ts
import { authEvents } from "@warlock.js/auth";

authEvents.on("login.attempt",   (credentials) => audit("login.attempt", credentials));
authEvents.on("login.success",   (user, tokens, deviceInfo) => audit("login.success", { user, deviceInfo }));
authEvents.on("login.failed",    (credentials, reason) => alertOnBruteForce(credentials, reason));
authEvents.on("logout",          (user) => audit("logout", { userId: user.id }));
authEvents.on("logout.all",      (user) => audit("logout.all", { userId: user.id }));
authEvents.on("logout.failsafe", (user) => alert(`Fail-safe logout for ${user.id}`));
authEvents.on("token.refreshed", (user, newPair, oldToken) => track(user, oldToken));
```

The `login.failed` event is the brute-force signal — wire it to a rate limiter or alert.

## Things to avoid

- **`authService.login(User, { password })` with no other key.** The non-password fields are the lookup; a password-only login is undefined behavior.
- **Returning the password hash.** Set `toJsonColumns` on your model.
- **Refresh token in `localStorage`.** Use an httpOnly secure cookie. Access token can sit in memory.
- **Bypassing `refreshTokens` on a "manual" refresh.** You'd skip the rotation revoke, the family check, the events.

## Related

- [Register a user](./register-user.md) — sign-up flow.
- [Protect routes](./protect-routes.md) — where the access token gets consumed.
- [Manage tokens](./manage-tokens.md) — rotation, family revocation, max-per-user.
