---
title: "Your first protected route"
description: A 5-minute worked example — register a user, log in, hit a protected /me endpoint with the token.
sidebar:
  order: 4
  label: "First protected route"
---

You've installed the package, generated secrets, and migrated the token tables. Now ship the smallest end-to-end flow: register, log in, hit a protected route.

This walks through three controllers and one model — under 60 lines of code.

## 1. Define the `User` model

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

Three things to notice:

- `extends Auth<...>` — your model inherits `createTokenPair`, `confirmPassword`, `activeSessions`, etc. from the auth base.
- `public get userType()` — the slug. It must match a key in `src/config/auth.ts` → `userType`.
- `toJsonColumns` — the explicit allowlist for the JSON response. Without this, the password hash leaks.

Register the model class in your auth config:

```ts title="src/config/auth.ts"
import type { AuthConfigurations } from "@warlock.js/auth";
import { env } from "@warlock.js/core";
import { User } from "@/app/users/models/user.model";

const authConfig: AuthConfigurations = {
  userType: { user: User },
  jwt: {
    secret: env("JWT_SECRET"),
    expiresIn: "1h",
    refresh: { secret: env("JWT_REFRESH_SECRET"), enabled: true, expiresIn: "30d" },
  },
};

export default authConfig;
```

Also write the matching Cascade migration for the `users` table — see [Cascade migrations](../../../cascade/the-basics/migrations/) for the shape.

## 2. The register controller

```ts title="src/app/users/controllers/register.controller.ts"
import { authService } from "@warlock.js/auth";
import { hashPassword, type Request, type Response } from "@warlock.js/core";
import { User } from "../models/user.model";

export async function registerController(request: Request, response: Response) {
  const { email, name, password } = request.all();

  const existing = await User.first({ email });

  if (existing) {
    return response.badRequest({ error: "Email already registered" });
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

That's the full register flow:

1. Duplicate check.
2. Create user with hashed password.
3. Issue access + refresh pair.
4. Respond.

## 3. The login controller

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

`authService.login` is the full happy path — verifies password, creates the token pair, fires events. Returns `null` on a miss; you map that to a 401.

## 4. The protected `/me` controller

```ts title="src/app/users/controllers/me.controller.ts"
import type { Request, Response } from "@warlock.js/core";

export async function meController(request: Request, response: Response) {
  return response.success({ user: request.user });
}
```

`request.user` is hydrated by the middleware before this controller runs. No manual decoding, no extra DB roundtrip in your code.

## 5. Wire the routes

```ts title="src/app/users/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { loginController } from "./controllers/login.controller";
import { meController } from "./controllers/me.controller";
import { registerController } from "./controllers/register.controller";

router.post("/register", registerController);
router.post("/login", loginController);
router.get("/me", meController, { middleware: [authMiddleware("user")] });
```

Only `/me` gets `authMiddleware("user")` — passed via the route's `middleware` array. Register and login must be reachable without a token, so they get no middleware.

## 6. Try it out

```bash
# Register
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct-horse-battery-staple"}'

# Response: { user: {...}, tokens: { accessToken: { token, expiresAt }, refreshToken: { token, expiresAt } } }

# Hit /me with the access token
curl http://localhost:3000/me \
  -H "Authorization: Bearer <accessToken.token>"

# Response: { user: { id, email, name, created_at } }

# Hit /me without a token
curl http://localhost:3000/me

# Response: 401 { error: "...", errorCode: "EC001" }
```

Done. You have register, login, and a protected endpoint. The rest of the documentation digs into the pieces.

## Where to go next

- [The auth flow](../essentials/01-the-auth-flow.md) — the full lifecycle including refresh and logout.
- [Protect routes](../guides/protect-routes.md) — middleware modes, route groups, user-type combos.
- [Manage tokens](../guides/manage-tokens.md) — rotation, family revocation, active sessions.
