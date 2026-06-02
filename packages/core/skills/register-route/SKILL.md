---
name: register-route
description: 'Register HTTP routes via @warlock.js/core''s router — single routes, prefix groups, middleware-guarded blocks, and RESTful resource chains. Routes always live in `src/app/<module>/routes.ts`. Triggers: `router.get`, `router.post`, `router.prefix`, `router.group`, `router.route`, `guarded`; "add a route", "wire a controller to a URL", "group routes by prefix", "register a RESTful resource"; typical import `import { router } from "@warlock.js/core"`. Skip: handler shape — `@warlock.js/core/create-controller/SKILL.md`; CRUD chain details — `@warlock.js/core/build-restful/SKILL.md`; middleware authoring — `@warlock.js/core/write-middleware/SKILL.md`; competing libs `express`, `fastify`, `koa`, `@nestjs/common`.'
---

# Warlock — register a route

How to declare HTTP routes in a Warlock module. The framework auto-loads `routes.ts` from every module on boot — never `import` it.

## The shape

```ts title="src/app/<module>/routes.ts"
import { router } from "@warlock.js/core";
import { listProductsController } from "./controllers/list-products.controller";

router.get("/products", listProductsController);
```

That's the entire contract for a simple route. `router` is a singleton; method calls register routes synchronously. The handler is a plain function (controllers are typed as `RequestHandler` — see [create-controller](../create-controller/SKILL.md)).

## HTTP verbs

```ts
router.get(path, handler);
router.post(path, handler);
router.put(path, handler);
router.patch(path, handler);
router.delete(path, handler);
```

`path` can be a string or a string array (multiple paths, one handler). Path params use `:name`: `router.get("/products/:id", getProductController)`.

## Prefix groups

A whole module typically prefixes its URLs with `/<module-name>`. Use `router.prefix(...)`:

```ts
router.prefix("/products", () => {
  router.get("/", listProductsController);
  router.get("/:id", getProductController);
  router.post("/", createProductController);
});
```

Nested `prefix` calls compose: `router.prefix("/api", () => router.prefix("/v1", () => router.get("/health", ...)))` registers `/api/v1/health`.

## Route groups with middleware

For routes that share both a prefix and middleware, use `router.group(...)`:

```ts
import { authMiddleware } from "@warlock.js/auth";

router.group(
  {
    prefix: "/admin",
    middleware: [authMiddleware("admin")],
  },
  () => {
    router.get("/dashboard", dashboardController);
    router.delete("/users/:id", removeUserController);
  },
);
```

`group` options:

- `prefix` — prepended to every route inside
- `middleware` — array of middleware applied to every route inside
- `name` — route-name prefix (used for URL generation)

## Auth-guarded shortcut

Projects with `@warlock.js/auth` usually define a `guarded(...)` helper in `src/app/shared/utils/router.ts` that wraps `router.group({ middleware: [authMiddleware("user")] }, …)`:

```ts
import { guarded } from "app/shared/utils/router";

router.prefix("/products", () => {
  router.get("/", listProductsController);             // public
  guarded(() => {
    router.post("/", createProductController);          // requires logged-in user
    router.delete("/:id", removeProductController);
  });
});
```

If `guarded` doesn't exist in your project yet, see the shared utility convention in [warlock-conventions](../warlock-conventions/SKILL.md).

## RESTful resource chain

For a standard CRUD resource, `router.route(path)` returns a builder with five named slots:

```ts
router.route("/products")
  .list(listProductsController)        // GET    /products
  .show(getProductController)          // GET    /products/:id
  .create(createProductController)     // POST   /products
  .update(updateProductController)     // PUT    /products/:id
  .destroy(removeProductController);   // DELETE /products/:id
```

Each method returns the builder so you can chain. Methods you don't call don't register. Pair with `guarded`/`group` the same way as plain routes.

## Common patterns

### A typical module's `routes.ts`

```ts
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

### Public + guarded mix

```ts
router.prefix("/auth", () => {
  router.post("/login", loginController);
  router.post("/register", registerController);
  guarded(() => {
    router.post("/logout", logoutController);
    router.get("/me", meController);
  });
});
```

### Multiple paths on one handler

```ts
router.get(["/health", "/healthz"], healthController);
```

## Gotchas

- **Never import `routes.ts`.** The framework auto-loads it. Importing causes a double-registration error.
- **Route order matters for static-vs-param overlap.** `router.get("/products/featured", ...)` must register before `router.get("/products/:id", ...)` if you want `featured` to be a static match, not `:id = "featured"`. Easier: use distinct paths.
- **`group` middleware runs in array order** before the controller; if you stack `[rateLimitMiddleware, authMiddleware]`, rate-limiting runs first.
- **Don't put logic in `routes.ts`.** It's a registration file. If you want conditional registration (env-flagged endpoints), do it via the controller's logic, not by branching at registration time — branching breaks the dev-server's HMR diff.

## See also

- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — the handler shape, validation, request/response surface.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — picking the right `response.<helper>()`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, the `guarded` convention, path aliases.
