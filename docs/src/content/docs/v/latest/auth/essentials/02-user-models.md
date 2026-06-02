---
title: "User models"
description: How your User model hooks into auth — extending Auth, the userType slot, and the methods you inherit.
sidebar:
  order: 2
  label: "User models"
---

Your app's `User` (and `Admin`, `Vendor`, etc.) is a Cascade model. To plug into auth, extend `Auth<TSchema>` instead of `Model<TSchema>`.

## What `Auth` gives you

`Auth` is `abstract class Auth<Schema> extends Model<Schema>`. You inherit everything Cascade models have, plus:

```ts
abstract get userType(): string;

public accessTokenPayload(): { id, userType, created_at };

public async createTokenPair(deviceInfo?): Promise<TokenPair>;
public async generateAccessToken(data?): Promise<AccessTokenOutput>;
public async generateRefreshToken(deviceInfo?): Promise<RefreshToken | undefined>;

public async removeAccessToken(token: string): Promise<void>;
public async removeRefreshToken(token: string): Promise<void>;
public async removeAllAccessTokens(): Promise<void>;
public async revokeAllTokens(): Promise<void>;

public async activeSessions(): Promise<RefreshToken[]>;

public async confirmPassword(password: string): Promise<boolean>;

public static async attempt(this, data): Promise<Auth | null>;
```

These are all thin wrappers around `authService.*`. You can call either form:

```ts
// Instance method
await user.createTokenPair(deviceInfo);

// Direct service call — same effect
await authService.createTokenPair(user, deviceInfo);
```

Use the instance form in domain code, the service form when the user instance isn't around yet (e.g. inside the login flow).

## The `userType` slot

`Auth` declares `userType` as `abstract get userType(): string`. Every subclass must override it:

```ts
@RegisterModel()
export class User extends Auth<typeof userSchema> {
  public static table = "users";
  public static schema = userSchema;

  public get userType() {
    return "user";
  }
}
```

The slug ("user") is what flows through every token, every middleware call, every event payload. The same slug must appear as a key in `src/config/auth.ts` → `userType`:

```ts
userType: {
  user: User,   // ← slug matches the getter
  admin: Admin,
}
```

Without that mapping, the middleware can't resolve which model class to hydrate from a token, and every request 401s.

## A minimal `User`

```ts title="src/app/users/models/user.model.ts"
import { Auth } from "@warlock.js/auth";
import { RegisterModel } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email().required(),
  name: v.string().min(2).max(120).required(),
  password: v.string().required(),
});

@RegisterModel()
export class User extends Auth<typeof userSchema> {
  public static table = "users";
  public static schema = userSchema;

  public static toJsonColumns = ["id", "email", "name", "created_at"];

  public get userType() {
    return "user";
  }
}
```

Two things to lock in:

- **`toJsonColumns` excludes `password`.** If you skip this, `JSON.stringify(user)` leaks the hash. Set it from day one.
- **Password is a normal column.** Auth doesn't add a `password` field to the schema — your schema defines it, your migration creates it, and you pass the hash on `create()`.

## Confirming a password without logging in

The `confirmPassword(plaintext)` instance method checks the plaintext against the stored hash. Useful for "confirm with current password" steps before changing email, changing password, deleting the account:

```ts
async function changeEmailController(request: Request, response: Response) {
  const user = request.user!;
  const valid = await user.confirmPassword(request.input("currentPassword"));

  if (!valid) {
    return response.unauthorized({ error: "Wrong password" });
  }

  await user.merge({ email: request.input("newEmail") }).save();
  return response.success({ user });
}
```

## `User.attempt` — static credential check

`Auth.attempt(data)` is a static helper — it's the same as `authService.attemptLogin(Model, data)` but reads more naturally:

```ts
const user = await User.attempt({ email, password });

if (!user) {
  return response.unauthorized({ error: "Invalid credentials" });
}

const tokens = await user.createTokenPair({ userAgent, ip });
```

This is the "verify credentials but don't issue tokens" path — handy when you're staging a login behind MFA or email confirmation.

## Custom token payloads

`generateAccessToken(data?)` accepts an arbitrary payload override. By default it's `{ id, userType, created_at }`. Add anything you want signed into the token:

```ts
const accessToken = await user.generateAccessToken({
  id: user.id,
  userType: user.userType,
  role: user.get("role"),
  workspaceId: user.get("active_workspace_id"),
});
```

Read it back in your controller from `request.decodedAccessToken`. Keep the payload small — every byte rides on every request.

## Related

- [The auth flow](./01-the-auth-flow.md) — where these methods get called.
- [Customize user type](../guides/customize-user-type.md) — multi-user-type apps.
- [Tokens](./03-tokens.md) — what `createTokenPair` produces and persists.
