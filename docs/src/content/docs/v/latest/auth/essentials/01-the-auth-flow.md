---
title: "The auth flow"
description: End-to-end tour — register, log in, hit a protected route, refresh, log out. The whole lifecycle on one page.
sidebar:
  order: 1
  label: "The auth flow"
---

This is the picture before the parts. Every other essentials and guides page zooms into one slice of what follows.

## The cast

- **`User` model** — your Cascade model, extends `Auth`, registered in `config.auth.userType`.
- **`authService`** — the orchestrator. Singleton exported from the package; holds no instance state.
- **`authMiddleware`** — the route gate. Hydrates `request.user` + `request.decodedAccessToken`.
- **`AccessToken` + `RefreshToken`** — Cascade models. Every token issued writes a row; verification checks the row; revocation deletes or stamps `revoked_at`.
- **`authEvents`** — type-safe event bus. Every meaningful moment fires here so you can wire audit logging, metrics, side effects.

## The lifecycle

### 1. Register

```ts
const user = await User.create({
  email, name,
  password: await hashPassword(plaintext),
});

const tokens = await authService.createTokenPair(user, { userAgent, ip });
```

`User.create` runs schema validation and persists the row. `createTokenPair` issues a fresh access token + refresh token, writes both to their tables, and emits `token.created` and `session.created`.

### 2. Log in

```ts
const result = await authService.login(
  User,
  { email, password },
  { userAgent, ip },
);

// result: { user, tokens: { accessToken, refreshToken } }  — or null on failure
```

Internally `login` runs `attemptLogin` (lookup by non-password fields + bcrypt compare on `password`), then `createTokenPair`. Events: `login.attempt`, then `login.success` or `login.failed`.

The `credentials` shape is **arbitrary** — every key except `password` becomes a filter on `User.first(...)`. Email + password, username + password, phone + OTP-hash — they all work.

### 3. Hit a protected route

The client sends:

```
GET /me
Authorization: Bearer <accessToken.token>
```

`authMiddleware("user")` runs before the controller:

1. Read `request.authorizationValue`. No header → 401 `MissingAccessToken`.
2. Verify the JWT signature via `jwt.verify(authorizationValue)`. Failure → catch → 401 `InvalidAccessToken`.
3. Look up the row in `access_tokens` by token string. Not found → 401 `InvalidAccessToken`.
4. Check the token's `userType` is in the allowed list (if the middleware was called with one). Not allowed → 401 `Unauthorized`.
5. Resolve the model class from `config.auth.userType[userType]`. Call `UserModel.find(decoded.id)`.
6. User missing (deleted account) → destroy the access-token row, 401 `InvalidAccessToken`.
7. Set `request.user` + `request.decodedAccessToken`. Continue to your controller.

### 4. Refresh

Access tokens are short-lived. When yours expires, the client hits the refresh endpoint with the refresh token:

```ts
const tokens = await authService.refreshTokens(refreshTokenString, { userAgent, ip });
// TokenPair | null
```

Internally:

1. `jwt.verifyRefreshToken(refreshTokenString)` — JWT signature check.
2. `RefreshToken.first({ token: refreshTokenString })` — row lookup.
3. If the row exists but is revoked (`revoked_at` set), **revoke the entire family** via `authService.revokeTokenFamily(familyId)`. Return `null`. This is the replay defense.
4. If the row is valid: with rotation on (the default), call `.revoke()` on the old token; create a brand new pair in the same family. With rotation off, mark as used (updates `last_used_at`) and reuse it.
5. Emit `token.refreshed` with the user, new pair, old token instance.

### 5. Log out

Two flavors.

**Specific device.** Client sends the refresh token; the server revokes that row only:

```ts
await authService.logout(user, accessTokenString, refreshTokenString);
```

**No refresh token sent.** Behavior depends on `config.auth.jwt.refresh.logoutWithoutToken`:

- `"revoke-all"` (default) — revoke every refresh token for this user; delete every access token.
- `"error"` — throw.

**Logout everywhere.** Same as the fail-safe path, but explicit:

```ts
await authService.revokeAllTokens(user);
```

Events: `logout` always fires; `logout.all` when every-device path is taken; `logout.failsafe` when the no-refresh-token fail-safe kicks in.

## Cross-cutting: events

Every step above emits something. Subscribe via `authEvents.on(...)`:

```ts
import { authEvents } from "@warlock.js/auth";

authEvents.on("login.success", (user, tokens, deviceInfo) => audit.log(user, deviceInfo));
authEvents.on("login.failed", (credentials, reason) => alertOnBruteForce(credentials, reason));
authEvents.on("token.familyRevoked", (familyId, tokens) => notifyUserOfBreach(tokens));
```

Full list: `login.attempt`, `login.success`, `login.failed`, `logout`, `logout.all`, `logout.failsafe`, `token.created`, `token.refreshed`, `token.revoked`, `token.expired`, `token.familyRevoked`, `password.changed`, `password.resetRequested`, `password.reset`, `session.created`, `session.destroyed`, `cleanup.completed`.

## Cross-cutting: persistence

Every token is a row. Both tables share the `user_id` + `user_type` pair so the same token table serves every user type in your app.

| Table | Written on | Read on | Deleted on |
| --- | --- | --- | --- |
| `access_tokens` | `generateAccessToken` | `authMiddleware` (existence check) | logout, `removeAllAccessTokens`, `revokeAllTokens` |
| `refresh_tokens` | `createRefreshToken` | `refreshTokens` (signature + validity check) | `cleanupExpiredTokens` (hard delete on expiry); soft-revoke via `revoked_at` on logout / rotation |

JWT verification stays stateless (the signature is enough to know the payload is genuine). The DB row gives you the revocation list — you can kill a token without changing the signing secret.

## Related

- [User models](./02-user-models.md) — what extending `Auth` gives your model.
- [Tokens](./03-tokens.md) — lifecycle, families, rotation, persistence in depth.
- [Protect routes](../guides/protect-routes.md) — middleware modes.
