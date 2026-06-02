---
title: "Role & permission checks"
description: Gate routes by a role or permission on a single user model — the RBAC layer that sits on top of authMiddleware.
sidebar:
  order: 3
  label: "Role & permission checks"
---

`authMiddleware` answers **"who are you?"** and gates by user *type* (user vs admin vs vendor — usually separate tables). It does **not** do fine-grained roles or permissions. When the distinction is a role *within* one user shape — an `admin` user who is also a `super-admin`, an `editor` vs a `viewer` — you build that on top.

The pattern: a `role` (or `permissions`) column on the user model, plus a small guard middleware that runs **after** `authMiddleware` (so `request.user` is already hydrated).

## 1. Put the role on the model

```ts title="src/app/users/models/user.model.ts"
import { Auth } from "@warlock.js/auth";
import { RegisterModel } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email().required(),
  password: v.string().required(),
  role: v.string().default("member"), // "member" | "editor" | "admin"
  permissions: v.array(v.string()).default([]), // e.g. ["posts.write", "users.read"]
});

@RegisterModel()
export class User extends Auth<typeof userSchema> {
  public static table = "users";
  public static schema = userSchema;

  public get userType() {
    return "user";
  }

  public get role(): string {
    return this.get("role", "member");
  }

  public hasRole(role: string): boolean {
    return this.role === role;
  }

  public hasPermission(permission: string): boolean {
    return this.get<string[]>("permissions", []).includes(permission);
  }
}
```

Adding `role` / `hasRole` / `hasPermission` as model accessors keeps the check in one place — your controllers and guards read `user.hasRole("admin")` instead of poking at raw columns.

## 2. A reusable role guard

A guard is just a middleware. It runs after `authMiddleware`, reads the already-hydrated `request.user`, and short-circuits with `403` when the role doesn't match.

```ts title="src/app/users/middleware/has-role.middleware.ts"
import type { Middleware, Request, Response } from "@warlock.js/core";
import type { User } from "../models/user.model";

/**
 * Build a guard that requires the authenticated user to hold one of the
 * given roles. Always pair it AFTER `authMiddleware` — it relies on
 * `request.user` being populated.
 *
 * @example
 * router.post("/posts", createPostController, {
 *   middleware: [authMiddleware("user"), hasRole("editor", "admin")],
 * });
 */
export function hasRole(...roles: string[]): Middleware {
  return (request: Request, response: Response) => {
    const user = request.user as User | undefined;

    if (!user || !roles.includes(user.role)) {
      return response.forbidden({ error: "Insufficient role" });
    }
  };
}
```

Returning a response short-circuits the request; returning nothing lets it fall through to the next middleware (and finally the controller). That's the whole middleware contract.

## 3. Wire it onto a route

Order matters: `authMiddleware` first (it hydrates `request.user`), then the role guard.

```ts title="src/app/posts/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { hasRole } from "@/app/users/middleware/has-role.middleware";
import { createPostController } from "./controllers/create-post.controller";

router.post("/posts", createPostController, {
  middleware: [authMiddleware("user"), hasRole("editor", "admin")],
});
```

For a whole admin area, hang both on a group:

```ts
router.group(
  { prefix: "/admin", middleware: [authMiddleware("user"), hasRole("admin")] },
  () => {
    router.get("/stats", statsController);
    router.delete("/posts/:id", deletePostController);
  },
);
```

## 4. Permission check inside a controller

When the rule is finer than a route — "you can edit *this* post only if you own it or you're an admin" — do it inline:

```ts title="src/app/posts/controllers/update-post.controller.ts"
import type { Request, Response } from "@warlock.js/core";
import type { User } from "@/app/users/models/user.model";
import { Post } from "../models/post.model";

export async function updatePostController(request: Request, response: Response) {
  const user = request.user as User;
  const post = await Post.find(request.input("id"));

  if (!post) {
    return response.notFound({ error: "Post not found" });
  }

  const isOwner = post.get("author_id") === user.id;

  if (!isOwner && !user.hasPermission("posts.moderate")) {
    return response.forbidden({ error: "You cannot edit this post" });
  }

  await post.merge(request.only(["title", "body"])).save();

  return response.success({ post });
}
```

Route-level guards handle the coarse "can this role reach this endpoint at all"; controller-level checks handle the row-specific "can this user touch this record". Use both.

## When to reach for separate user types instead

If the difference is structural — different tables, different schemas, different registration flows (admins created in a back-office, users self-registering) — model them as separate [user types](../guides/customize-user-type.md) and gate with `authMiddleware("admin")`. Roles-on-one-model is the right tool only when the user *shape* is shared and the difference is a privilege level.

## Related

- [Protect routes](../guides/protect-routes.md) — `authMiddleware` and how middleware attaches to routes.
- [Customize user type](../guides/customize-user-type.md) — the separate-tables alternative.
- [`@warlock.js/core` middleware](../../../core/the-basics/middleware/) — writing custom middleware in general.
