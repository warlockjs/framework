---
title: "Customize user type"
description: Multi-user-type auth — users + admins + vendors in one app, on separate tables, with per-type login and route gating.
sidebar:
  order: 5
  label: "Customize user type"
---

`Auth` has a `userType` slot. Subclass it once per type, register each subclass under `config.auth.userType.<slug>`, and the auth flow handles the rest.

## When to reach for it

The "do I need multi-user-type" decision:

- **Different tables / schemas** — admins have `admin_level`; vendors have `business_name`. Use multi-user-type.
- **Separate registration flows** — admins are created via an admin panel; users self-register. Use multi-user-type.
- **Truly distinct concepts** — clients vs vendors in a marketplace. Use multi-user-type.

If users and admins differ only by a `role` column on the same table, that's role-based access — keep one `User` model and check the role at the controller layer.

## Define a model per type

```ts title="src/app/users/models/user.model.ts"
import { Auth } from "@warlock.js/auth";
import { RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class User extends Auth<typeof userSchema> {
  public static table = "users";
  public static schema = userSchema;

  public get userType() {
    return "user";
  }
}
```

```ts title="src/app/admins/models/admin.model.ts"
import { Auth } from "@warlock.js/auth";
import { RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class Admin extends Auth<typeof adminSchema> {
  public static table = "admins";
  public static schema = adminSchema;

  public get userType() {
    return "admin";
  }
}
```

Each type gets its own table, its own schema, its own `userType` slug. They don't share rows — they're separate models, separate migrations, separate concerns.

## Register them in the config

```ts title="src/config/auth.ts"
import type { AuthConfigurations } from "@warlock.js/auth";
import { env } from "@warlock.js/core";
import { Admin } from "@/app/admins/models/admin.model";
import { User } from "@/app/users/models/user.model";

const authConfig: AuthConfigurations = {
  userType: {
    user: User,
    admin: Admin,
    // staff: Staff,
    // vendor: Vendor,
  },
  jwt: {
    secret: env("JWT_SECRET"),
    expiresIn: "1h",
    refresh: { secret: env("JWT_REFRESH_SECRET"), enabled: true, expiresIn: "30d" },
  },
};

export default authConfig;
```

The keys (`"user"`, `"admin"`) are the canonical slugs. They appear in every token, every middleware call, every `refresh_tokens.user_type` row, every event payload.

## Gate routes per user type

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

router.get("/account", userAccountController, { middleware: [authMiddleware("user")] });
router.get("/admin/users", listUsersController, { middleware: [authMiddleware("admin")] });
router.get("/back-office", backOfficeController, { middleware: [authMiddleware(["admin", "staff"])] });
router.get("/dashboard", dashboardController, { middleware: [authMiddleware([])] }); // any logged-in
```

See [Protect routes](./protect-routes.md) for the middleware modes in detail.

## Login per user type — pass the right Model

`authService.login(Model, credentials, deviceInfo?)` is keyed off the model you pass:

```ts
// User login endpoint
const userResult = await authService.login(User, credentials);

// Admin login endpoint
const adminResult = await authService.login(Admin, credentials);
```

The user-type slug on the issued token comes from the model instance's `userType` getter, so `authMiddleware` later knows which class to hydrate.

You typically expose two different endpoints — `/login` and `/admin/login` — each with its own controller calling the appropriate model.

## Cross-type behavior

- **Tokens are scoped to their issuing user-type.** A `user`-type token can't unlock `admin`-type routes.
- **`access_tokens` + `refresh_tokens` carry `user_type`.** One table per token kind, all user types share it; the column distinguishes.
- **`authMiddleware(["admin", "user"])`** allows either — useful for endpoints shared between roles (e.g. a profile page where the layout differs but both populations can hit it).

## What your `Auth` subclass inherits

```ts
abstract class Auth<TSchema> extends Model<TSchema> implements Authenticable {
  // all Model<> methods, plus:
  abstract get userType(): string;

  public accessTokenPayload(): { id, userType, created_at };

  public createTokenPair(deviceInfo?): Promise<TokenPair>;
  public generateAccessToken(payload?): Promise<AccessTokenOutput>;
  public generateRefreshToken(deviceInfo?): Promise<RefreshToken | undefined>;

  public removeAccessToken(token): Promise<void>;
  public removeRefreshToken(token): Promise<void>;
  public removeAllAccessTokens(): Promise<void>;
  public revokeAllTokens(): Promise<void>;
  public activeSessions(): Promise<RefreshToken[]>;

  public confirmPassword(password): Promise<boolean>;

  public static attempt(this, data): Promise<Auth | null>;
}
```

The only required override is `userType`. Everything else has a default that delegates to `authService`.

## Custom access-token payload per type

You can shape the access-token payload differently per user-type — for example, embedding `admin_level` only on admin tokens. Override `accessTokenPayload()` on the subclass:

```ts
@RegisterModel()
export class Admin extends Auth<typeof adminSchema> {
  public get userType() {
    return "admin";
  }

  public accessTokenPayload() {
    return {
      id: this.id,
      userType: this.userType,
      admin_level: this.get("admin_level"),
      created_at: Date.now(),
    };
  }
}
```

This payload rides on every admin access token and shows up on `request.decodedAccessToken` in admin-protected controllers.

## Things to avoid

- **Multi-user-type for role-based access.** If users and admins differ only in a `role` column, that's RBAC — keep one User and check the role at the controller.
- **Forgetting the `userType` getter override.** Without it, the lookup in `config.auth.userType` fails and the middleware can't hydrate the model.
- **Two models claiming the same slug.** `config.auth.userType` maps each slug to exactly one class. Pick distinct slugs.
- **Same table, two models.** Multi-user-type means separate tables. Same-table-flag-column is RBAC again.

## Related

- [Protect routes](./protect-routes.md) — `authMiddleware` semantics.
- [Handle login and logout](./handle-login-and-logout.md) — passing the right Model to `login`.
- [User models](../essentials/02-user-models.md) — what `Auth` gives you.
