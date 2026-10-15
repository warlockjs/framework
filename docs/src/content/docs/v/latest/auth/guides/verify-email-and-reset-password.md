---
title: "Verify email and reset password"
description: Hashed, single-use, expiring tokens for email verification and password reset, delivered through @warlock.js/notifications.
sidebar:
  order: 7
  label: "Verify email & reset password"
---

New in 5.13: four service functions, one guard, and two throttle presets. Auth ships no controllers or routes — wire those yourself, as shown below.

## Prerequisites

1. **`@warlock.js/notifications` installed and configured with a `mail` channel.** It's an optional peer; without it (or without `src/config/notifications.ts`) every send/request call throws `NotificationsUnavailableError` **before** a token is issued — never a silent skip.
2. **The `one_time_tokens` table.** It ships in `authMigrations` next to the access/refresh tables — run your migrations.
3. **A verified-date field on the user schema** (default `emailVerifiedAt`):

```ts title="src/app/users/models/user.model.ts"
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  // ...
  emailVerifiedAt: v.date().optional(),
});
```

If the schema strips that field, `verifyEmail` throws naming it, instead of silently pretending the verification worked.

## Tokens

- 32 random bytes, base64url. Only the **SHA-256 hash** is stored; the raw token exists only in the notification.
- **Single use**, consumed with a conditional update — of two concurrent uses, exactly one succeeds.
- **Expiring**: verification `24h`, reset `60m` by default (`auth.verification.expiresIn` / `auth.passwordReset.expiresIn`).
- **Purpose-bound**: a verification token is never accepted by `resetPassword`, and vice versa.
- A new reset request **invalidates the user's earlier unused reset tokens**. Verification tokens are not invalidated by a resend.
- Unknown, wrong-purpose, expired, and already-used tokens all throw the same `InvalidOneTimeTokenError` (`400`, `EC008`) — no oracle for which case it was.

## Email verification

```ts
import { requireVerifiedEmail, sendEmailVerification, verifyEmail, isEmailVerified } from "@warlock.js/auth";
import { type RequestHandler } from "@warlock.js/core";

// right after User.create(...) in your register controller
await sendEmailVerification(user);

export const verifyEmailController: RequestHandler = async ({ request, response }) => {
  const user = await verifyEmail(request.input("token")); // throws InvalidOneTimeTokenError
  return response.success({ user });
};

router.post("/auth/verify-email", verifyEmailController, {
  middleware: [tokenConsumeThrottleMiddleware()],
});

router.post("/auth/verify-email/resend", resendController, {
  middleware: [authMiddleware("user"), tokenIssueThrottleMiddleware({ by: ["ip"] })],
});

// Opt-in guard, AFTER authMiddleware: throws EmailNotVerifiedError (403, EC007)
router.post("/orders", createOrder, {
  middleware: [authMiddleware("user"), requireVerifiedEmail()],
});
```

`isEmailVerified(user)` answers the same question in code, without throwing.

## Password reset

```ts
import { requestPasswordReset, resetPassword } from "@warlock.js/auth";

export const forgotPasswordController: RequestHandler = async ({ request, response }) => {
  await requestPasswordReset(User, request.input("email"));
  // Same answer whether or not the account exists — anti-enumeration.
  return response.success({ message: "If that account exists, we sent a reset link." });
};

export const resetPasswordController: RequestHandler = async ({ request, response }) => {
  // Validate password strength FIRST — the token is consumed before the password is written.
  await resetPassword(request.input("token"), request.input("password"));
  return response.success({ message: "Password updated. Please log in again." });
};

router.post("/auth/forgot-password", forgotPasswordController, {
  middleware: [tokenIssueThrottleMiddleware()], // 3 / 1h per email + per IP
});
router.post("/auth/reset-password", resetPasswordController, {
  middleware: [tokenConsumeThrottleMiddleware()], // 10 failures / 15m per IP
});
```

`resetPassword` writes the new password, then calls `authService.revokeAllTokens(user)`: every refresh token is revoked and every access token deleted — which also kills cookie sessions, since a cookie session is backed by an access-token row. It emits `password.reset`; `requestPasswordReset` emits `password.resetRequested`.

**Password hashing.** By default auth saves `hashPassword(plain)` and checks it with `verifyPassword`, the same check login uses. If your model already hashes on save (`useHashedPassword()`), that first write would be hashed twice and fail the check — so auth falls back to saving the plaintext and lets your transformer hash it once, then verifies again. If neither write passes the check, it throws rather than leaving a broken password in place. To take over entirely, set `auth.passwordReset.setPassword(user, plain)`.

## Throttling

Both presets wrap `loginThrottleMiddleware` and accept its options:

| Preset | Tracks | Counts | Default |
| --- | --- | --- | --- |
| `tokenIssueThrottleMiddleware()` | email + IP | **every** request — a reset request's success is the anti-enumeration answer, so failure-aware counting would never trip | 3 / 1h, 1h lock |
| `tokenConsumeThrottleMiddleware()` | IP | failures only, cleared on success | 10 / 15m, 15m lock |

## Configuration (`src/config/auth.ts`)

```ts
const authConfigurations: AuthConfigurations = {
  // ...
  verification: {
    expiresIn: "24h",
    field: "emailVerifiedAt",
    url: (token) => `${env("APP_URL")}/verify-email?token=${token}`,
    notification: myVerificationNotification, // optional replacement
  },
  passwordReset: {
    expiresIn: "60m",
    identifierField: "email",
    url: (token) => `${env("APP_URL")}/reset-password?token=${token}`,
    notification: myResetNotification,
    setPassword: async (user, plain) => { /* optional */ },
  },
  oneTimeToken: { model: AppOneTimeToken }, // optional model override
};
```

The default notifications are `defineNotification` objects (`type: "auth.email-verification"` / `"auth.password-reset"`, `via: ["mail"]`). To replace one, pass anything with a `send(user, { token, expiresAt, url? })` method — for example your own `defineNotification<OneTimeTokenNotificationData>({...})`. `@warlock.js/notifications` still has to be installed and configured either way.

## Gotchas

- **Without `url` configured, the email contains the raw token**, not a link. Set `url` for anything user-facing.
- **Timing isn't equalized.** An unknown email skips the database write and the send, so the response can come back measurably faster. Throttling limits probing, but it doesn't hide the timing difference.
- **Channel send failures don't throw.** `@warlock.js/notifications` only rethrows configuration errors (such as a missing `mail` channel). An SMTP failure goes to its `failed` event — observe it there.
- `auth.cleanup` does not purge `one_time_tokens` yet. Expired rows are harmless but accumulate.

## Related

- [Register a user](./register-user.md) — where `sendEmailVerification` is usually called.
- [Manage tokens](./manage-tokens.md) — `authService.revokeAllTokens`, which `resetPassword` calls.
- [API reference](../reference/api.md) — `AuthErrorCodes.EmailNotVerified` (`EC007`) / `InvalidOneTimeToken` (`EC008`).
