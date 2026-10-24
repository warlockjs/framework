---
name: register-route
description: 'Register HTTP routes via @warlock.js/core''s router — single routes, prefix groups, middleware-guarded blocks, and RESTful resource chains. Routes always live in `src/app/<module>/routes.ts`. Triggers: `router.get`, `router.post`, `router.prefix`, `router.group`, `router.route`, `guarded`; "add a route", "wire a controller to a URL", "group routes by prefix", "register a RESTful resource"; typical import `import { router } from "@warlock.js/core"`. Skip: handler shape — the `create-controller` topic; CRUD chain details — the `build-restful` topic; middleware authoring — the `write-middleware` topic; competing libs `express`, `fastify`, `koa`, `@nestjs/common`.'
---

# Warlock — register a route

How to declare HTTP routes in a Warlock module. The framework auto-loads `routes.ts` from every module on boot — never `import` it.

## The shape

```ts title="src/app/<module>/routes.ts"
import { router } from "@warlock.js/core";
import { listProductsController } from "./controllers/list-products.controller";

router.get("/products", listProductsController);
```

## Named API metadata for browser forms

Give a browser-submitted API route a stable `name`. Web publishes only its
name, path, and method to `useSubmitForm`; controllers, middleware, schemas,
and source paths never reach the browser.

```ts
router.post("/orders/:id", createOrderController, { name: "orders.create" });
```

Use a concrete HTTP verb for browser forms. `router.any()` is represented as
`all` metadata and requires callers to choose an explicit path and method.

That's the entire contract for a simple route. `router` is a singleton; method calls register routes synchronously. The handler is a plain function (controllers are typed as `RequestHandler` — see the `create-controller` topic).

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
  router.get("/", listProductsController); // public
  guarded(() => {
    router.post("/", createProductController); // requires logged-in user
    router.delete("/:id", removeProductController);
  });
});
```

If `guarded` doesn't exist in your project yet, see the shared utility convention in the `warlock-conventions` topic.

### A mutating route with no guard — say so with `public: true`

```ts
// src/app/contact/routes.ts
router.post("/api/contact", contactController, { public: true });
```

`public: true` changes nothing at runtime; it records that the missing guard is deliberate, so reviewers, `warlock check` and route tooling can tell a decision from an omission. `warlock make endpoint --public` writes it (the `make-endpoint` topic).

## RESTful resource chain

For a standard CRUD resource, `router.route(path)` returns a builder with five named slots:

```ts
router
  .route("/products")
  .list(listProductsController) // GET    /products
  .show(getProductController) // GET    /products/:id
  .create(createProductController) // POST   /products
  .update(updateProductController) // PUT    /products/:id
  .destroy(removeProductController); // DELETE /products/:id
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
  router.post("/login", loginController, { public: true });
  router.post("/register", registerController, { public: true });
  guarded(() => {
    router.post("/logout", logoutController);
    router.get("/me", meController);
  });
});
```

### Mutating routes: guard them or say `public: true`

Every POST/PUT/PATCH/DELETE route either runs auth middleware (on the route, its
builder, or an enclosing group such as `guarded()`) or is marked `public: true`.
`warlock dev` warns once per route about mutating routes with neither, and
`warlock check` reports the same from source as `WL9006` before the app runs.
The check reads source, not runtime markers: a guard counts when its name
contains `auth` or `guard`, or when it is a constant initialised with
`markAuthGuard()` in the same file. A differently-named guard imported from
another file needs a `// warlock-check-ignore WL9006` comment on its route.

```ts
import { markAuthGuard, router, type Middleware, type RequestHandler } from "@warlock.js/core";

const stripeWebhookController: RequestHandler = async ({ response }) =>
  response.success({ received: true });
const importController: RequestHandler = async ({ response }) => response.success({ queued: true });

// Open on purpose: a webhook signed by the provider.
router.group({ prefix: "/webhooks", public: true }, () => {
  router.post("/stripe", stripeWebhookController);
});

// A hand-written guard whose name has no "auth"/"guard" in it.
const requireApiKey: Middleware = markAuthGuard(async ({ request, response }) => {
  if (request.headers["x-api-key"] !== process.env.API_KEY) return response.unauthorized();
});

router.post("/imports", importController, { middleware: [requireApiKey] });
```

`public` changes nothing at runtime. `authMiddleware()` marks itself (its
`{ optional: true }` form does not count). Silence the warning app-wide with
`http.warnUnguardedRoutes: false`; page routes are never reported.

### Multiple paths on one handler

```ts
router.get(["/health", "/healthz"], healthController);
```

### Sensitive routes: keep input out of the logs

```ts
router.post("/accounts/credentials", accountsController.store, {
  logging: { body: false, query: false },
});
```

Request log entries otherwise include the body as received (before validation), so rejected fields would be logged too.

## Static directories and public files

```ts
router.directory({ root: Application.publicPath, prefix: "/assets/" });
```

Static routes are queued at scan time after HTTP plugin hooks. `@fastify/static` itself loads only on
the first static file request, even with an existing public folder; concurrent
first requests share initialization. The upstream sender retains ranges, caching,
listings, precompressed files, `allowedPath` and `setHeaders` behavior. The
`setHeaders` callback receives the real Fastify reply.

`wildcard: false` still enumerates exact file routes at boot, so files added later
follow the application's ordinary fallback until restart. The directory globber
loads at boot only for this option; the upstream sender enumerates those roots
again on the first request, which can be noticeable for large directories. The public folder uses
`storage.publicRoot` (default `public/`) and `storage.publicPrefix` (default
`/public/`); `false` disables it and missing folders add no routes. Its
`reply.sendFile`/`reply.download` decorators are lazy too. `router.directory`
keeps `decorateReply: false` for additional mounts. Initialization failures reach
the application's normal error handler.

Global rate limits apply to application routes and web page routes in
production and development. Defaults are 60 requests/minute per IP in one shared
bucket across routes and pages. Behind a reverse proxy, configure trusted
`http.trustProxy` addresses or a suitable `http.rateLimit.keyGenerator`, and
review `max` before upgrading. `http.rateLimit.global: false` disables blanket
quotas while retaining explicit route limits. Built-in health/readiness probes
are exempt unless `http.health.rateLimit: true` opts them into the global policy.

Static files are exempt from the global limiter by default: the public folder,
every `router.directory()` mount and `router.file()` / `cachedFile()` / `files()` /
`cachedFiles()` routes (and the web build's assets). `http.rateLimit.staticFiles:
true` counts them all; a mount can decide for itself:

```ts
import { rootPath, router } from "@warlock.js/core";

router.directory({ root: rootPath("storage/exports"), prefix: "/exports/" }, { rateLimit: true });
router.directory(
  { root: rootPath("storage/reports"), prefix: "/reports/" },
  { rateLimit: { max: 20, timeWindow: 60_000 } },
);
router.file("/price-list.pdf", rootPath("storage/price-list.pdf"), 300, { rateLimit: true });
```

Exempt one application route with `rateLimit: false` (or
`serverOptions: { config: { rateLimit: false } }`); development's wildcard
dispatcher honours both exactly as production does:

```ts
router.get("/webhooks/status", webhookStatusController, { rateLimit: false });
```

## Gotchas

- **Never import `routes.ts`.** The framework auto-loads it. Importing causes a double-registration error.
- **Route order matters for static-vs-param overlap.** `router.get("/products/featured", ...)` must register before `router.get("/products/:id", ...)` if you want `featured` to be a static match, not `:id = "featured"`. Easier: use distinct paths.
- **`group` middleware runs in array order** before the controller; if you stack `[rateLimitMiddleware, authMiddleware]`, rate-limiting runs first.
- **Don't put logic in `routes.ts`.** It's a registration file. If you want conditional registration (env-flagged endpoints), do it via the controller's logic, not by branching at registration time — branching breaks the dev-server's HMR diff.

## See also

- The `create-controller` topic — the handler shape, validation, request/response surface.
- The `send-response` topic — picking the right `response.<helper>()`.
- The `warlock-conventions` topic — module layout, the `guarded` convention, path aliases.

## A named route the browser must never call — `clientVisible: false`

A named API route is embedded in a page's browser route table only when that page's client code reaches its name. Mark an endpoint that browser code must never reach with `clientVisible: false`:

```ts
router.post("/internal/reindex", reindexController, {
  name: "internal.reindex",
  clientVisible: false,
});
```

It is then never embedded in a page, and `warlock check` reports a browser reference to its name as `WL9020` (an error). The server still authorizes the call as for any route.

### Offer a route to some sites only — `sites`

In a multi-site app a route answers on every host, and a page of any site may embed it in its browser table. Declare the sites that may embed it on the route or on a group; a route's own `sites` replaces its group's, and a route with none is shared:

```ts
router.group({ prefix: "/api/admin", sites: ["admin"] }, () => {
  router.post("/users", createUser, { name: "admin.users.create" });
});
```

This limits the browser table only; keep the route's guard. A guard in the route's middleware chain (group middleware included) also keeps it out of a guest's table, and a custom guard must say so with `markAuthGuard(fn)` unless its name contains `auth` or `guard`. `warlock inspect`, `warlock agents-md` and `WL9006` read the same chain, so a guard declared once on a group guards every route inside it.
