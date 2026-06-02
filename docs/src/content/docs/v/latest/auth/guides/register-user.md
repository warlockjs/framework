---
title: "Register a user"
description: Two-step server-side sign-up — create the user with a hashed password, then issue the initial token pair.
sidebar:
  order: 1
  label: "Register a user"
---

Sign-up is two steps on the server: persist the user with a hashed password, then issue tokens. Cascade handles step one; `authService` handles step two.

## The minimal controller

```ts title="src/app/users/controllers/register.controller.ts"
import { authService } from "@warlock.js/auth";
import { hashPassword, type Request, type Response } from "@warlock.js/core";
import { User } from "../models/user.model";

export async function registerController(request: Request, response: Response) {
  const { email, name, password } = request.all();

  const existing = await User.first({ email });

  if (existing) {
    return response.conflict({ error: "Email already registered" });
  }

  const user = await User.create({
    email,
    name,
    password: await hashPassword(password),
  });

  const tokens = await authService.createTokenPair(user, {
    userAgent: request.header("user-agent"),
    ip: request.ip,
  });

  return response.successCreate({ user, tokens });
}
```

That's the whole flow.

## Hash on the way in — always

`hashPassword` lives in `@warlock.js/core`. It's bcrypt with the cost factor from `config.auth.password.salt` (default `12`).

```ts
import { hashPassword, verifyPassword } from "@warlock.js/core";

const hash = await hashPassword(plaintext);          // store this
const ok = await verifyPassword(plaintext, hash);    // compare later
```

You normally don't call `verifyPassword` directly — `authService.attemptLogin` does it for you during login.

## Schema enforcement

Define password strength on the schema, not in the controller:

```ts title="src/app/users/models/user.model.ts"
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email().required(),
  name: v.string().min(2).max(120).required(),
  password: v.string().min(12).required(),
});
```

`User.create({...})` validates against this schema before persisting. Bad passwords get rejected at the persistence boundary; your controller doesn't need to duplicate the check.

## Don't leak the hash

Set `static toJsonColumns` on the model:

```ts
public static toJsonColumns = ["id", "email", "name", "created_at"];
```

Without this, `JSON.stringify(user)` (which happens implicitly when you return the user in a response) leaks the password hash. The allowlist closes that door.

## Add device info to the refresh token

```ts
const tokens = await authService.createTokenPair(user, {
  userAgent: request.header("user-agent"),
  ip: request.ip,
  deviceId: request.input("deviceId"),
});
```

These land on `refresh_tokens.device_info` and surface later in `authService.getActiveSessions(user)`. Useful for "manage your sessions" UIs.

## Email verification pattern

Auth doesn't ship verification flows — you wire that on top:

```ts
import { Random } from "@mongez/reinforcements";

const user = await User.create({
  ...data,
  email_verified: false,
  verification_token: Random.string(64),
});

await mailer.sendVerificationEmail(user.get("email"), user.get("verification_token"));

const tokens = await authService.createTokenPair(user);
return response.successCreate({ user, tokens });
```

Two ways to gate unverified users:

1. **Add a `email_verified` check** in your protected controllers. Simple, explicit.
2. **Use a separate `unverified` user-type.** Issue tokens with `userType: "unverified"`; flip to `"user"` after verification. Lets you scope routes via `authMiddleware("user")` without touching every controller. See [Customize user type](./customize-user-type.md).

## Side effects via events

Post-registration logic via the event bus:

```ts
import { authEvents } from "@warlock.js/auth";

authEvents.on("session.created", async (user, refreshToken, deviceInfo) => {
  const fresh = Date.now() - new Date(user.get("created_at")).getTime() < 5000;

  if (fresh) {
    await sendWelcomeEmail(user);
  }
});
```

The cleaner alternative: emit your own `user.registered` event from the controller. It decouples your domain from auth-package internals.

## Things to avoid

- **Plain password to `User.create`.** Always hash first.
- **Returning the user without `toJsonColumns`.** Hash leak.
- **Validation in the controller.** Let the schema do it.
- **Inline `sendWelcomeEmail` blocking the response.** Push it to a queue. The user shouldn't wait for SMTP.

## Related

- [Handle login and logout](./handle-login-and-logout.md) — same `createTokenPair` step, with credentials verification first.
- [User models](../essentials/02-user-models.md) — the `Auth` base class your `User` extends.
- [Manage tokens](./manage-tokens.md) — what `createTokenPair` produces in detail.
