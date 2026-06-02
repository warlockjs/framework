---
title: "Manage tokens"
description: Issue, rotate, revoke, and clean up access + refresh tokens — the full lifecycle as runnable snippets.
sidebar:
  order: 4
  label: "Manage tokens"
---

The mechanics under login and logout. Most apps never need to touch these directly — `authService.login` and `authService.logout` cover the everyday paths. Reach for these when you're customizing the flow.

## Issuing tokens

```ts
import { authService } from "@warlock.js/auth";

// Just an access token — rare. Use createTokenPair instead.
const access = await authService.generateAccessToken(user);

// Just a refresh token
const refresh = await authService.createRefreshToken(user, deviceInfo);

// Both — the everyday case
const pair = await authService.createTokenPair(user, deviceInfo);
```

`createTokenPair` respects `config.auth.jwt.refresh.enabled`. If refresh is disabled, the returned `TokenPair` has `refreshToken: undefined`.

The instance-method form is equivalent:

```ts
const pair = await user.createTokenPair(deviceInfo);
```

## Refresh with rotation — `refreshTokens`

```ts
const next = await authService.refreshTokens(oldRefreshToken, deviceInfo);
// next: TokenPair | null
```

What happens internally:

1. **Verify the JWT signature** on the old refresh token via `jwt.verifyRefreshToken`.
2. **Find the row** in `refresh_tokens` by token string. Missing → return `null`.
3. **Check validity** via `refreshToken.isValid` (not expired, not revoked).
4. **If invalid but the row exists**, that's a replay — `revokeTokenFamily(familyId)`. Return `null`.
5. **Resolve the user** via `config.auth.userType[token.userType]` + `Model.find(decoded.userId)`. Missing → `null`.
6. **Rotate**: with `config.auth.jwt.refresh.rotation` on (default), call `.revoke()` on the old token; with rotation off, call `.markAsUsed()`.
7. **Issue a new pair** in the same `family_id`. Emit `token.refreshed`.

## Family — the rotation chain

Every refresh-token lineage shares a `family_id` (random 32-char string at first issuance). Each successful rotation keeps the same family; a replay revokes the whole family.

```
login              → family X, token A
refresh (A)        → family X, token B   (A.revoked_at set)
refresh (B)        → family X, token C   (B.revoked_at set)
refresh (A again)  → A already revoked → revoke EVERY token in family X
```

Logout on one device kills only that device's family — other devices keep their own families and stay logged in.

## Listing active sessions

```ts
const sessions = await authService.getActiveSessions(user);

for (const session of sessions) {
  session.get("device_info");   // { userAgent, ip, deviceId? } if it was provided
  session.get("created_at");
  session.get("expires_at");
}
```

Returns the active (non-revoked, non-expired) `RefreshToken` instances. Use it for "manage your sessions" UIs.

To revoke a specific session, call `.revoke()` on the instance:

```ts
const sessions = await user.activeSessions();   // shortcut for authService.getActiveSessions(this)
const target = sessions.find((session) => session.get("device_info")?.deviceId === "abc");
await target?.revoke();
```

## Revocation entry points

```ts
// Specific access token (deletes the row)
await authService.removeAccessToken(user, accessTokenString);

// Specific refresh token, soft (via the model)
const refreshToken = await RefreshToken.first({ token: refreshTokenString });
await refreshToken?.revoke();

// Specific refresh token, hard delete (rare)
await authService.removeRefreshToken(user, refreshTokenString);

// All access tokens for a user (rows deleted)
await authService.removeAllAccessTokens(user);

// Everything — access rows deleted + every active refresh token revoked
await authService.revokeAllTokens(user);

// One whole family
await authService.revokeTokenFamily(familyId);
```

The instance-method shortcuts:

```ts
await user.removeAccessToken(accessTokenString);
await user.removeAllAccessTokens();
await user.revokeAllTokens();
```

## Max refresh tokens per user

`config.auth.jwt.refresh.maxPerUser` (default `5`). When issuing a new refresh token, the service counts active tokens for the user; if the count is at-or-above the cap, the oldest are revoked until count < cap.

Two effects:

- Bounds simultaneous sessions per user.
- Limits the damage if an attacker accumulates tokens — older ones get cycled out automatically.

Don't crank this to a huge number "to be safe" — every active refresh token is a revocation surface.

## Expired-token cleanup

```ts
const cleaned = await authService.cleanupExpiredTokens();
// Returns the count of removed expired refresh tokens.
// Fires "token.expired" per token + "cleanup.completed" with the total.
```

It's a single indexed delete; cheap. Schedule it via the warlock scheduler or run the bundled CLI on cron — see [Run auth commands](./run-auth-commands.mdx).

In-process:

```ts
import { scheduler, job } from "@warlock.js/scheduler";
import { authService } from "@warlock.js/auth";

scheduler.addJob(
  job("auth-cleanup", () => authService.cleanupExpiredTokens())
    .daily()
    .at("03:00")
    .preventOverlap(),
);
```

## JWT helpers — `jwt`

Low-level sign / verify, sitting under `authService`. Reach for them only when the service-level methods don't cover what you need:

```ts
import { jwt } from "@warlock.js/auth";

const token   = await jwt.generate(payload, { expiresIn: 3600 });
const decoded = await jwt.verify(token);

const refresh        = await jwt.generateRefreshToken(payload, { expiresIn });
const decodedRefresh = await jwt.verifyRefreshToken(refresh);
```

Each call resolves the signing key (`config.auth.jwt.secret` or `config.auth.jwt.refresh.secret`) and algorithm (`config.auth.jwt.algorithm`, default `HS256`) at call time. You can override the key per call if you really need to (you usually don't).

The separation of secrets — one for access, one for refresh — is deliberate. An access-token compromise can't forge refresh tokens; a refresh-token compromise can't forge access tokens.

## Things to avoid

- **Hand-rolling JWT signing.** The package handles signing, verification, secret loading, and the access/refresh split — including the algorithm config.
- **Disabling rotation without thinking.** You lose replay detection.
- **Bumping `maxPerUser` to a huge number.** More active tokens = bigger revocation surface.
- **Deleting `access_tokens` rows in a custom service.** Mid-flight requests will get inconsistent state. Use the `authService` helpers.

## Related

- [Tokens](../essentials/03-tokens.md) — the conceptual model under these methods.
- [Handle login and logout](./handle-login-and-logout.md) — `login` / `logout` use everything here.
- [Run auth commands](./run-auth-commands.mdx) — the bundled cleanup CLI.
