---
title: "Tokens"
description: How access and refresh tokens are issued, persisted, rotated, revoked, and cleaned up.
sidebar:
  order: 3
  label: "Tokens"
---

Auth uses a JWT pair plus a database row per token. The JWT gives you stateless verification; the row gives you stateful revocation. Both matter — neither alone is enough.

## The pair

```ts
type AccessTokenOutput = { token: string; expiresAt: string };

type TokenPair = {
  accessToken: AccessTokenOutput;
  refreshToken?: AccessTokenOutput;   // omitted when config.auth.jwt.refresh.enabled is false
};
```

`expiresAt` is an ISO-formatted UTC string — convenient for the client without further parsing.

## Access tokens

**Short-lived.** Default expiry: `1h` (`config.auth.jwt.expiresIn`).

**Signing key:** `config.auth.jwt.secret`.

**Persistence:** one row in `access_tokens` per issued token. Columns: `token`, `user_id`, `user_type`, `is_active`, `last_access`.

**Verification path:** `authMiddleware` runs `jwt.verify(token)` then looks the token string up in `access_tokens`. Both must pass.

**Revocation:** delete the row. The next request to `authMiddleware` 401s on the existence check.

## Refresh tokens

**Long-lived.** Default expiry: `7d` (both the `AuthConfigurations.jwt.refresh.expiresIn` recommendation and the runtime fallback when omitted). Opt in to non-expiring refresh tokens by setting `expiresIn: NO_EXPIRATION` (the constant resolves to `100y`).

**Signing key:** `config.auth.jwt.refresh.secret` — separate from the access-token secret on purpose.

**Persistence:** one row in `refresh_tokens` per issued token. Columns include `token`, `user_id`, `user_type`, `family_id`, `expires_at`, `last_used_at`, `revoked_at`, `device_info`.

**Verification path:** `authService.refreshTokens(...)` runs `jwt.verifyRefreshToken(token)` then looks the row up. Both must pass; `revoked_at` must be null; `expires_at` must be in the future.

## The family — rotation as a chain

Every refresh-token lineage shares a `family_id` (a random 32-char string generated at first issuance):

```
login              → family X, token A
refresh (A)        → family X, token B  (A.revoked_at set)
refresh (B)        → family X, token C  (B.revoked_at set)
refresh (A again)  → A is already revoked → revoke EVERY token in family X
```

The fourth step is the replay defense. Someone presenting an already-revoked token has either:

- A buggy client retrying with the old token (unusual but harmless to revoke the family — they'll re-login).
- A leaked token where the legit user already refreshed and the attacker now tries the old one.

Family-wide revocation kills both attacker and victim. The victim re-logs in; the attacker is locked out.

## Rotation policy

`config.auth.jwt.refresh.rotation`:

- `true` (default) — `refreshTokens` revokes the old refresh token and returns a fresh pair. The replay defense above kicks in.
- `false` — the old token is marked "used" (`last_used_at` bumped) but stays valid. You can hit the refresh endpoint a thousand times with the same token. No replay defense.

The default is the right call. Only flip it off if you're certain you understand the tradeoff.

## Per-user cap

`config.auth.jwt.refresh.maxPerUser` (default `5`) caps simultaneous active refresh tokens per user. Issuing a new one when the cap is reached revokes the oldest first.

This bounds the revocation surface — if an attacker silently accumulates tokens by logging in from many "devices", you still have a hard ceiling.

## Device info

`createTokenPair(user, deviceInfo?)` accepts a `DeviceInfo` slot that lands in `refresh_tokens.device_info`:

```ts
{
  userAgent?: string;
  ip?: string;
  deviceId?: string;
  familyId?: string;    // internal — for staying in an existing family
  payload?: Record<string, any>;  // custom access-token payload
}
```

The `userAgent` / `ip` / `deviceId` keys flow straight into the row. They show up on `getActiveSessions(user)` for "manage your devices" screens.

`familyId` is used internally when refreshing — you keep the old family. Don't set it manually on login.

`payload` overrides the default access-token payload (`{ id, userType, created_at }`). Use it to embed extra signed claims.

## Cleanup

Expired refresh-token rows hang around until you sweep them:

```ts
const count = await authService.cleanupExpiredTokens();
```

Schedule it via `@warlock.js/scheduler` or run the bundled CLI on cron — see [Run auth commands](../guides/run-auth-commands.mdx). The check is a single indexed DELETE on `expires_at < now()`; cheap. Daily is plenty for most apps.

## Issuance entry points

| Method | What it does |
| --- | --- |
| `authService.generateAccessToken(user, payload?)` | Just access. Writes one `access_tokens` row. |
| `authService.createRefreshToken(user, deviceInfo?)` | Just refresh. Writes one `refresh_tokens` row. Returns `undefined` if refresh is disabled. |
| `authService.createTokenPair(user, deviceInfo?)` | Both. Emits `token.created` + `session.created`. The everyday path. |
| `user.createTokenPair(deviceInfo?)` | Instance-method form. Same as the line above. |

## Revocation entry points

| Method | What it does |
| --- | --- |
| `authService.removeAccessToken(user, token)` | Deletes one `access_tokens` row. |
| `RefreshToken#revoke()` | Stamps `revoked_at = now()` on this row. |
| `authService.removeRefreshToken(user, token)` | Deletes one `refresh_tokens` row outright (hard delete; rare — use `revoke()` for the audit trail). |
| `authService.removeAllAccessTokens(user)` | Deletes every `access_tokens` row for this user. |
| `authService.revokeAllTokens(user)` | Revokes every active refresh token + deletes every access token. Emits `token.revoked` per row, `logout.all` once. |
| `authService.revokeTokenFamily(familyId)` | Revokes every refresh token sharing the given family. Emits `token.familyRevoked`. |

## Related

- [Manage tokens](../guides/manage-tokens.md) — practical recipes for the methods above.
- [Run auth commands](../guides/run-auth-commands.mdx) — `warlock auth.cleanup` + scheduling.
- [API reference](../reference/api.md) — every exported identifier in one table.
