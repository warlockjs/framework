---
title: "Protected routes"
description: Lock routes behind `@warlock.js/auth` — JWT verification, per-role groups, project-local `guarded()` helpers, role checks beyond auth, and the right status codes for the wrong reasons.
sidebar:
  order: 6
  label: "Protected routes"
---

Most APIs need a "you must be logged in" boundary somewhere. Warlock's `@warlock.js/auth` package gives you JWT-backed authentication that drops in as middleware — one factory call, one wrapper, every guarded route inherits it. This recipe walks the full path: install, configure, wrap routes, read the authenticated user, layer role checks, and pick the right status codes when access is denied.

## What you get from `@warlock.js/auth`

- **`authMiddleware(userType?)`** — a factory that returns a Warlock middleware. Verifies the `Authorization: Bearer <jwt>` header, loads the user model from the DB, and attaches it to `request.user`.
- **`authService`** — login/register/refresh/logout primitives on top of `AccessToken` and `RefreshToken` Cascade models.
- **`registerJWTSecretGeneratorCommand()`** + **`registerAuthCleanupCommand()`** — CLI factories you wire into `warlock.config.ts > cli.commands` for `warlock jwt.generate` and `warlock auth.cleanup`.

You're not building this from scratch. The package is the API.

## Step 1 — Install and bootstrap auth

```bash
yarn add @warlock.js/auth
```

Then wire the package's auth migrations and CLI commands in `warlock.config.ts`:

```ts title="warlock.config.ts"
import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
  database: {
    migrations: authMigrations,
  },
});
```

`authMigrations` ships the `access_tokens` and `refresh_tokens` tables. Generate a JWT secret:

```bash
yarn warlock jwt.generate
```

The command writes `JWT_SECRET` (and `JWT_REFRESH_SECRET`) into your `.env`. Then run migrations:

```bash
yarn warlock migrate
```

You now have the schema. The deep details of login flows, refresh tokens, and user-type registration live in the auth package's own docs; this recipe focuses on the route side.

## Step 2 — The middleware itself

```ts title="anywhere in your app"
import { authMiddleware } from "@warlock.js/auth";

const requireUser = authMiddleware("user");
const requireAdmin = authMiddleware("admin");
const requireAny = authMiddleware();
```

What the factory does, from `@warlock.js/auth/src/middleware/auth.middleware.ts`:

1. Reads `Authorization: Bearer <token>` from the request.
2. Verifies the JWT (signature + expiry).
3. Looks up the matching `AccessToken` row in the DB. If the token was revoked (e.g. via `auth.cleanup`), it's gone.
4. Resolves the user-type model class from `auth.userType.<type>` config and loads the user by `id`.
5. Attaches the model to `request.user`.

If any step fails, the middleware returns `401` with an `errorCode` and a translated message — the controller never runs.

The `userType` argument is a string or string array. Common values:

| Argument             | Effect                                                       |
| -------------------- | ------------------------------------------------------------ |
| `authMiddleware()`   | Optional auth — populates `request.user` if a token is present, but doesn't `401` when missing. Useful for endpoints that change behavior based on whether the caller is logged in. |
| `authMiddleware("user")`            | Requires a valid `user`-type token.                                                       |
| `authMiddleware("admin")`           | Requires a valid `admin`-type token.                                                      |
| `authMiddleware(["user", "admin"])` | Either user type is accepted.                                                             |

User types live in your `auth` config (`src/config/auth.ts`) under `userType: { user: User, admin: Admin }`. The middleware does `config.key("auth.userType.<type>")` to find the model class.

## Step 3 — The project-local router helpers

Most projects don't sprinkle `authMiddleware(...)` everywhere — they put it once behind a small helper. The convention is `src/app/shared/utils/router.ts`:

```ts title="src/app/shared/utils/router.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

export function publicRoutes(callback: () => void) {
  router.group(
    {
      prefix: "/",
    },
    callback,
  );
}

export function guardedAdmin(callback: () => void) {
  router.group(
    {
      prefix: "/admin",
      middleware: [authMiddleware()],
    },
    callback,
  );
}

export function guarded(callback: () => void) {
  router.group(
    {
      middleware: [authMiddleware("user")],
    },
    callback,
  );
}
```

Three helpers, three patterns:

- **`publicRoutes`** — no middleware. Pure sugar for grouping public routes at the root.
- **`guarded`** — `authMiddleware("user")`. The default for user-facing endpoints.
- **`guardedAdmin`** — `authMiddleware()` (any authenticated user) plus an `/admin` prefix.

You can extend with `guardedManager`, `guardedSupport`, etc. — same shape, different role and prefix.

## Step 4 — Use the helpers in `routes.ts`

A module's `routes.ts` typically mixes public and guarded routes:

```ts title="src/app/auth/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { forgotPassword } from "./controllers/forgot-password.controller";
import { login } from "./controllers/login.controller";
import { logoutAll } from "./controllers/logout-all.controller";
import { logout } from "./controllers/logout.controller";
import { me } from "./controllers/me.controller";
import { refreshToken } from "./controllers/refresh-token.controller";
import { registerController } from "./controllers/register.controller";
import { resetPasswordController } from "./controllers/reset-password.controller";

router.prefix("/auth", () => {
  router.post("/login", login);
  router.post("/register", registerController);
  router.post("/refresh-token", refreshToken);
  router.post("/forgot-password", forgotPassword);
  router.post("/reset-password", resetPasswordController);

  guarded(() => {
    router.post("/logout", logout);
    router.post("/logout-all", logoutAll);
    router.get("/me", me);
  });
});
```

`/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` are public — you can't log in before you have a token. `/auth/logout`, `/auth/logout-all`, `/auth/me` need the token they're operating on.

For a resource that's entirely behind auth, wrap the whole RESTful chain:

```ts title="src/app/products/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { createProductController } from "./controllers/create-product.controller";
import { getProductController } from "./controllers/get-product.controller";
import { listProductsController } from "./controllers/list-products.controller";
import { removeProductController } from "./controllers/remove-product.controller";
import { updateProductController } from "./controllers/update-product.controller";

guarded(() => {
  router
    .route("/products")
    .list(listProductsController)
    .show(getProductController)
    .create(createProductController)
    .update(updateProductController)
    .destroy(removeProductController);
});
```

## Step 5 — Read the user inside the controller

Once auth middleware runs, `request.user` holds the resolved model instance. The auth middleware sets it via `request.user = currentUser` after loading from the DB. Type it via the `GuardedRequest` alias in the project — most apps have one in `src/app/auth/types/guarded-request.type.ts`:

```ts title="src/app/auth/types/guarded-request.type.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import type { User } from "app/users/models/user";

export type GuardedRequest<RequestPayload = unknown> = Request<RequestPayload> & {
  user: User;
};

export type GuardedRequestHandler<RequestPayload = unknown> = RequestHandler<
  GuardedRequest<RequestPayload>
>;
```

Then in a controller:

```ts title="src/app/auth/controllers/me.controller.ts"
import { type GuardedRequestHandler } from "../types/guarded-request.type";

export const me: GuardedRequestHandler = async (request, response) => {
  return response.success({
    user: request.user,
  });
};
```

`request.user` is the full Cascade model — call `request.user.get("email")` for typed access, or just rely on the model's own getters (`request.user.email`).

## Step 6 — Per-route middleware (not just groups)

Group-level middleware is the common case. Sometimes you want middleware on a single route inside a larger group:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

router.prefix("/posts", () => {
  router.get("/", listPostsController);                                  // public
  router.get("/:id", getPostController);                                 // public
  router.post("/", { middleware: [authMiddleware("user")] }, createPostController);
  router.delete("/:id", { middleware: [authMiddleware("admin")] }, deletePostController);
});
```

Same factory, attached per-route. Use this when most of a section is public and only one or two endpoints need locking down — the inverse of the wrapper pattern.

## Step 7 — Role checks beyond auth

`authMiddleware("user")` answers "is this a logged-in user?" It doesn't answer "is this _that specific_ user?" Ownership checks belong in the controller (or a use-case):

```ts title="src/app/posts/controllers/update-post.controller.ts"
import { ResourceNotFoundError } from "@warlock.js/core";
import { type GuardedRequestHandler } from "app/auth/types/guarded-request.type";
import { Post } from "../models/post";
import {
  type UpdatePostSchema,
  updatePostSchema,
} from "../schema/update-post.schema";

export const updatePostController: GuardedRequestHandler<UpdatePostSchema> = async (
  request,
  response,
) => {
  const post = await Post.find(request.input("id"));

  if (!post) {
    throw new ResourceNotFoundError("Post not found");
  }

  if (post.get("author_id") !== request.user.id) {
    return response.forbidden({ error: "You can only edit your own posts" });
  }

  await post.merge(request.validated()).save();

  return response.success({ post });
};

updatePostController.validation = {
  schema: updatePostSchema,
};
```

Two things to notice:

1. **401 vs 403** — the middleware returns `401` (you have no valid token). The controller returns `403` (you have a token, but you can't do _this_). Both are auth-shaped errors, but the meaning is different — `401` says "log in," `403` says "logging in won't help."
2. **Ownership lives in the controller, not the middleware.** A middleware can't read the post — it'd need to refetch on every request even when the controller already does. Keep auth and authorization separate.

For richer role logic (admin-only fields, scope-based access), the same pattern scales:

```ts
if (!request.user.hasRole("editor") && !post.get("author_id") === request.user.id) {
  return response.forbidden({ error: "Editors only" });
}
```

`hasRole` is a method you add to the user model. The framework doesn't ship a role system because every project's role model is different — yours might be RBAC, ACL, or scope-based.

## Step 8 — Optional auth

Sometimes a route changes behavior based on whether the user is logged in, but doesn't require it. Call `authMiddleware()` with no argument:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

router.group(
  {
    middleware: [authMiddleware()],
  },
  () => {
    router.get("/products/:slug", showProductController);
  },
);
```

```ts title="src/app/products/controllers/show-product.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { Product } from "../models/product";

export const showProductController: RequestHandler = async (request, response) => {
  const product = await Product.first({ slug: request.input("slug") });

  if (!product) {
    return response.notFound({ error: "Product not found" });
  }

  // request.user is User | undefined here
  if (request.user) {
    await trackProductView(product.id, request.user.id);
  }

  return response.success({ product });
};
```

The middleware short-circuits when no token is present (no `401`), but populates `request.user` when one is.

## 401 vs 403 — the rule

| Status | Meaning                                          | Triggered by                                                                                  |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `401`  | "You're not authenticated."                      | Missing/invalid/expired token. Returned by `authMiddleware`.                                  |
| `403`  | "You're authenticated, but you can't do this."   | Authorization failure — wrong role, not the owner, plan tier doesn't allow it. Returned by your controller. |

Don't conflate the two. A client receiving `401` knows to refresh the token or redirect to login. A `403` tells them to stop trying — refreshing won't help. Use `response.unauthorized(...)` for `401` and `response.forbidden(...)` for `403`.

## Gotchas

- **Auth tokens are checked against the DB on every request.** Logging out (`/auth/logout`) deletes the row from `access_tokens`; the next request with that token gets `401`. This is by design — stateless JWT can't be revoked, but Warlock revokes the DB record.
- **`request.user` is `undefined` outside guarded routes.** Even with the `GuardedRequest` type, it's a type-only narrowing — the actual property doesn't exist until the middleware runs. Don't access it on public routes.
- **`request.clearCurrentUser()` exists.** The middleware calls it internally if token verification throws. You probably never call it yourself — just be aware it nukes `request.user`.
- **Don't put `authMiddleware` after a heavy middleware.** Middleware runs in array order; an auth check that runs after rate-limiting wastes rate-limit budget on unauthenticated requests. Auth first.
- **Per-user rate limiting requires the user to be loaded.** If you stack `[authMiddleware("user"), rateLimitMiddleware]`, the limiter can read `request.user.id`. The reverse stacks the wrong direction.

## See also

- [Routing](../the-basics/02-routing.md) — `router.group`, `router.route`, prefix nesting
- [Middleware guide](../the-basics/middleware.md) — middleware signature, ordering, custom middleware
- [Controllers](../the-basics/03-controllers.md) — request typing with generic `Request<Schema>`
- ``register-route` skill`
- ``write-middleware` skill`
- ``hash-password` skill` — `hashPassword`/`verifyPassword` for login flows
