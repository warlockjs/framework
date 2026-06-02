---
title: "Routing"
description: The router singleton, path params, prefix groups, middleware groups, the RESTful resource chain, and where routes live in a Warlock module.
sidebar:
  order: 1
  label: "Routing"
---

The router is how URLs become handlers. In Warlock it's a singleton — you import `router` from `@warlock.js/core` and call `.get(...)` / `.post(...)` / a group / a resource chain. Every call registers a route synchronously; the framework collects them at boot and binds them to Fastify.

The point of this page is the *shape* — what's available, where it lives, and the patterns you'll see in every Warlock module. Deep details (rate limiting, route names, source-file tracking for HMR) live in [Routing — deep dive](./routing-deep.md).

## Where routes live

Every module owns a `routes.ts` at the root of its folder:

```
src/app/
  faqs/
    routes.ts           ← public surface of this module
    controllers/
    services/
    ...
```

`routes.ts` is **auto-loaded** by the framework at boot. **Don't import it from anywhere.** Importing causes a double-registration error.

If a module has no public HTTP surface (e.g. a worker-only module), skip the file entirely — `routes.ts` is optional.

## The basics

A single route is one method call:

```ts title="src/app/products/routes.ts"
import { router } from "@warlock.js/core";
import { listProductsController } from "./controllers/list-products.controller";

router.get("/products", listProductsController);
```

That's the entire contract for a simple route. `router` is the singleton; `listProductsController` is a plain function typed as `RequestHandler`.

### HTTP verbs

The router covers the five everyday verbs plus the niche ones:

```ts
router.get(path, handler);
router.post(path, handler);
router.put(path, handler);
router.patch(path, handler);
router.delete(path, handler);
router.head(path, handler);
router.options(path, handler);
router.any(path, handler);    // matches all methods
```

Most apps need the top five. `head` / `options` / `any` are there when you reach for them.

### Path parameters

URL parameters use `:name` and land on `request.params`:

```ts
router.get("/products/:id", getProductController);
router.get("/posts/:postId/comments/:commentId", showCommentController);
```

Inside the handler:

```ts
const id = request.input("id");
// or
const id = request.params.id;
// or, the typed shortcut for the canonical `/:id`:
const id = request.idParam;
```

`request.input(...)` reads from query, params, and body uniformly — convenient when you don't care which segment a value came from.

### Multiple paths, one handler

Pass an array of paths to register the same handler against each:

```ts
router.get(["/health", "/healthz"], healthController);
```

Useful for legacy alias paths or platform-specific probe URLs.

## Prefix groups

A whole module typically prefixes its URLs with `/<module-name>`. Use `router.prefix(prefix, callback)`:

```ts
router.prefix("/products", () => {
  router.get("/", listProductsController);          // GET    /products
  router.get("/:id", getProductController);         // GET    /products/:id
  router.post("/", createProductController);        // POST   /products
  router.patch("/:id", updateProductController);    // PATCH  /products/:id
  router.delete("/:id", deleteProductController);   // DELETE /products/:id
});
```

Nested `prefix` calls compose. This:

```ts
router.prefix("/api", () => {
  router.prefix("/v1", () => {
    router.get("/health", healthController);
  });
});
```

…registers `GET /api/v1/health`. The router collects prefixes onto a stack and joins them.

## Middleware groups

`router.group(options, callback)` is `prefix` plus middleware (and an optional route-name prefix):

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

Three options:

| Option       | What it does                                       |
| ------------ | -------------------------------------------------- |
| `prefix`     | Prepended to every route inside                    |
| `middleware` | Applied to every route inside, in array order      |
| `name`       | Route-name prefix (used for URL generation)        |

Middleware runs in array order *before* the controller. If you stack `[rateLimitMiddleware, authMiddleware]`, rate-limiting runs first.

## The `guarded()` convention

Most projects with `@warlock.js/auth` define a tiny helper in `src/app/shared/utils/router.ts`:

```ts title="src/app/shared/utils/router.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

export function guarded(callback: () => void) {
  router.group(
    {
      middleware: [authMiddleware("user")],
    },
    callback,
  );
}
```

Now every "requires-login" block reads naturally:

```ts
import { guarded } from "app/shared/utils/router";

router.prefix("/auth", () => {
  router.post("/login", loginController);
  router.post("/register", registerController);
  guarded(() => {
    router.post("/logout", logoutController);
    router.get("/me", meController);
  });
});
```

A single line — `guarded(() => { ... })` — communicates "everything in this block needs a valid user token." Pair with a `guardedAdmin(...)` variant for admin-only blocks. The pattern keeps `routes.ts` clean of middleware repetition.

## RESTful resource chain

For a standard CRUD resource, `router.route(path)` returns a builder with five named slots:

```ts
router
  .route("/products")
  .list(listProductsController)        // GET    /products
  .show(getProductController)          // GET    /products/:id
  .create(createProductController)     // POST   /products
  .update(updateProductController)     // PUT    /products/:id
  .destroy(removeProductController);   // DELETE /products/:id
```

Each method returns the builder so you can chain. Methods you don't call don't register — list-only resources stop at `.list(...)`.

The slots map to method + path like this:

| Slot         | Method | Path                  | Typical use     |
| ------------ | ------ | --------------------- | --------------- |
| `.list(h)`   | GET    | `/products`           | paginated list  |
| `.show(h)`   | GET    | `/products/:id`       | get one         |
| `.create(h)` | POST   | `/products`           | create new      |
| `.update(h)` | PUT    | `/products/:id`       | replace one     |
| `.destroy(h)`| DELETE | `/products/:id`       | delete one      |

There's also `.patch(h)`, `.patchOne(h)`, `.getOne(h)`, and a `.crud({ ... })` shorthand for passing every handler in one object — see [Routing — deep dive](./routing-deep.md).

## A complete `routes.ts`

Here's the actual `faqs` module from the reference codebase — every common pattern in eighteen lines:

```ts title="src/app/faqs/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { createFaqController } from "./controllers/create-faq.controller";
import { deleteFaqController } from "./controllers/delete-faq.controller";
import { getFaqController } from "./controllers/get-faq.controller";
import { listFaqsController } from "./controllers/list-faqs.controller";
import { updateFaqController } from "./controllers/update-faq.controller";

guarded(() => {
  router
    .route("/faqs")
    .list(listFaqsController)
    .show(getFaqController)
    .create(createFaqController)
    .update(updateFaqController)
    .destroy(deleteFaqController);
});
```

Read it left-to-right: every route in this module requires a logged-in user (`guarded`), the resource path is `/faqs`, and the five CRUD slots map to the matching controller. A new teammate can read this file in five seconds and know the entire public surface.

## Public + guarded mix

For auth flows where most routes are public but a couple require a token:

```ts title="src/app/auth/routes.ts"
router.prefix("/auth", () => {
  router.post("/login", loginController);
  router.post("/register", registerController);
  router.post("/forgot-password", forgotPasswordController);

  guarded(() => {
    router.post("/logout", logoutController);
    router.post("/logout-all", logoutAllController);
    router.get("/me", meController);
  });
});
```

`guarded(...)` blocks compose freely inside a `prefix(...)`. Stack as many as the module needs.

## API versioning

`router.version(n, callback)` is shorthand for `router.prefix("/v<n>", ...)`:

```ts
router.version(1, () => {
  router.get("/users", listUsersV1);    // /v1/users
});

router.version(2, () => {
  router.get("/users", listUsersV2);    // /v2/users
});
```

Combine with prefix and group as needed.

## Gotchas

- **Never import `routes.ts` from anywhere.** The framework auto-loads it. Importing it double-registers every route.
- **Order matters for static-vs-param overlap.** Register `router.get("/products/featured", ...)` *before* `router.get("/products/:id", ...)` if you want `featured` to be a literal match, not `:id = "featured"`. Easier rule: use distinct paths when you can.
- **Don't put logic in `routes.ts`.** It's a registration file. If you want conditional registration (env-flagged endpoints), do it inside the controller, not by branching at registration time — branching breaks the dev-server's HMR diff.
- **Middleware in `group` runs in array order**, then the controller. `[rateLimitMiddleware, authMiddleware]` means rate-limit first, auth second.

## See also

- **[Controllers](./03-controllers.md)** — what the handler on the other side of the route looks like.
- **[Routing — deep dive](./routing-deep.md)** — route names, rate limits, source-file tracking for HMR, the `.crud(...)` shorthand, nested resource builders.
- **[Middleware](./middleware.md)** — writing custom middleware, the request/response contract, common patterns.
- **[Protected routes recipe](../recipes/protected-routes.md)** — combining `guarded` with role-based middleware.

## Next

Continue to **[Controllers](./03-controllers.md)** to see how a handler reads inputs and shapes responses.
