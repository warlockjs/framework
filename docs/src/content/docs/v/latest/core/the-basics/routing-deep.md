---
title: "Routing — deep dive"
description: Every public method on the router — verbs, groups, the route builder, RESTful resources, redirects, static files, proxies, named routes, scan callbacks, and the ordering rules you need to know.
sidebar:
  order: 2
  label: "Routing (deep)"
---

[Essentials → Routing](./02-routing.md) covers the basics — the router singleton, path params, prefix groups, the RESTful resource chain. This page goes through every public method, the ordering rules, the named-route hook, the static-file and proxy surfaces, and the scan-time callbacks you'll reach for once you start writing infrastructure code on top of the router.

If you've never registered a route before, start with the essentials page. If you have and you're hitting "the router has a method I haven't used and I'm not sure when to reach for it," this is the index.

## The full method surface

| Category        | Methods                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| Verb routes     | `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `any`                             |
| Builders        | `route(path)` → `RouteBuilder`, `restfulResource(path, resource)`                             |
| Grouping        | `group(options, callback)`, `prefix(prefix, callback)`, `version(version, callback)`          |
| Redirects       | `redirect(from, to, mode?)`                                                                   |
| Static files    | `directory(options)`, `file(path, location, cacheTime?)`, `cachedFile`, `files`, `cachedFiles`|
| Proxy           | `proxy(path, baseUrl, options?)`, `proxy(options)`                                            |
| Scan hooks      | `beforeScanning(callback)`, `afterScanning(callback)`                                         |
| Introspection   | `list()`, `getRoute(name, params?)`                                                           |

Each section below walks the methods in that category.

## Verb routes

The eight verb registrations:

```ts
router.get(path, handler, options?);
router.post(path, handler, options?);
router.put(path, handler, options?);
router.patch(path, handler, options?);
router.delete(path, handler, options?);
router.head(path, handler, options?);
router.options(path, handler, options?);
router.any(path, handler, options?);     // matches ALL methods
```

`post` and `delete` accept either a single path or an array of paths (the framework registers each one). The others take a single string:

```ts
router.post(["/products", "/items"], createHandler);   // both routes hit the same handler
router.delete(["/products/:id", "/items/:id"], deleteHandler);
```

`any` registers the same handler under all HTTP methods — useful for catch-all routes (a "not found" handler at the end of a prefix group, for instance).

### The handler shape

A handler is a `RequestHandler`:

```ts
type RequestHandler = (request: Request, response: Response) => ReturnedResponse | void;
```

It can have static properties for validation and OpenAPI metadata:

```ts
handler.validation = { schema, validate, validating };
handler.description = "Lists all products";
handler.responseSchema = { 200: { body: { products: [ProductResource] } } };
```

The router doesn't care if you write the handler as `function`, `const = async`, or `(request, response) => ...` — anything callable works. Most projects use named `const` exports for the controller-per-file convention.

### Route options

```ts
router.get("/products", listProducts, {
  name: "products.list",                    // explicit route name
  middleware: [authMiddleware()],
  middlewarePrecedence: "before",           // before group middleware (default: after)
  description: "Lists all products",
  rateLimit: { max: 60, timeWindow: 60_000 },
  serverOptions: { /* Fastify route options */ },
});
```

The full surface:

| Option                  | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `name`                  | Explicit route name (default: auto-generated from the path, dots replace slashes)    |
| `middleware`            | Array of middleware fns for this route                                               |
| `middlewarePrecedence`  | `"before"` or `"after"` — order vs. group middleware (default: `"after"`)            |
| `description`           | Free text for OpenAPI / docs                                                          |
| `label`                 | Route label for docs                                                                  |
| `restful`               | Marks the route as part of a RESTful resource (the framework sets this for you)      |
| `isPage`                | Marks the route as React SSR-rendered                                                 |
| `rateLimit`             | Per-route rate limit override                                                         |
| `serverOptions`         | Fastify route-shorthand options for very low-level tuning                            |

## The `RouteBuilder` chain

`router.route(path)` returns a `RouteBuilder` — a chainable builder that registers multiple verbs against the same path:

```ts
router
  .route("/products")
  .list(listProducts)        // GET /products
  .create(createProduct)     // POST /products
  .show(showProduct)         // GET /products/:id
  .update(updateProduct)     // PUT /products/:id
  .destroy(deleteProduct);   // DELETE /products/:id
```

The semantic aliases (`list`, `create`, `show`, `update`, `destroy`) map to verb methods that auto-append `/:id` where appropriate:

| Alias       | Underlying call                                       |
| ----------- | ----------------------------------------------------- |
| `.list(h)`  | `router.get(path, h)` — collection read               |
| `.create(h)`| `router.post(path, h)` — collection write             |
| `.show(h)`  | `router.get(path + "/:id", h)` — single resource read |
| `.update(h)`| `router.put(path + "/:id", h)` — single resource write|
| `.patch(h)` | `router.patch(path + "/:id", h)` — partial update     |
| `.destroy(h)`| `router.delete(path + "/:id", h)` — single delete    |

The verb methods on the builder are also exposed directly — `.get(h)`, `.post(h)`, `.put(h)`, `.patch(h)`, `.delete(h)` — but those don't auto-append `/:id`. The aliases are syntactic sugar over them.

### Direct verb methods on the builder

```ts
router
  .route("/products")
  .get(listProducts)         // GET /products (same path)
  .getOne(showProduct)       // GET /products/:id
  .post(createProduct)       // POST /products
  .postOne(specialAction)    // POST /products/:id
  .put(replaceAll)           // PUT /products (rare)
  .updateOne(updateProduct)  // PUT /products/:id
  .delete(deleteAll)         // DELETE /products (bulk delete)
  .deleteOne(deleteOne);     // DELETE /products/:id
```

The `.xxxOne` variants append `/:id`. The base verbs don't. Use whichever reads more clearly for the endpoint.

### Each verb is registered once

The builder tracks which verbs have been added — calling `.get(...)` twice on the same builder throws:

```
Error: Route /products already has a GET method
```

That's intentional: it forces you to think about which collection-vs-resource pattern you're using.

### `.crud(handlers)` — one-shot CRUD

```ts
router.route("/products").crud({
  list: listProducts,
  create: createProduct,
  show: showProduct,
  update: updateProduct,
  destroy: deleteProduct,
  patch: patchProduct,
});
```

Equivalent to chaining the five aliases. Each field is optional — `crud` only registers the handlers you provide. Useful when the chain reads more naturally as an object.

### `.nest(path)` — nested resources

For `/posts/:id/comments`-style nested routes:

```ts
router
  .route("/posts/:id")
  .show(showPost)
  .nest("/comments")
    .list(listComments)          // GET /posts/:id/comments
    .create(createComment);      // POST /posts/:id/comments
```

`.nest(path)` returns a NEW `RouteBuilder` rooted at the concatenated path, with the parent builder's options merged in. The original builder is unaffected — you can keep chaining on it after the `.nest(...)` returns.

## `restfulResource(path, resource)`

A class-based alternative to `RouteBuilder` — for cases where your CRUD lives on a controller object with `list`, `get`, `create`, `update`, `delete`, `patch`, `bulkDelete` methods:

```ts
router.restfulResource("/products", productController);
```

The framework wires:

| Method            | Verb + path                  |
| ----------------- | ---------------------------- |
| `list()`          | `GET /products`              |
| `get()`           | `GET /products/:id`          |
| `create()`        | `POST /products`             |
| `update()`        | `PUT /products/:id`          |
| `patch()`         | `PATCH /products/:id`        |
| `delete()`        | `DELETE /products/:id`       |
| `bulkDelete()`    | `DELETE /products` (no `:id`)|

Only methods that exist on the resource get registered — if your controller doesn't define `patch`, no `PATCH` route is added.

You can scope which methods get registered:

```ts
router.restfulResource("/products", productController, {
  only: ["list", "get", "create"],
});

router.restfulResource("/products", productController, {
  except: ["delete"],
});
```

`replace` lets you swap individual handlers without rewriting the whole resource:

```ts
router.restfulResource("/products", productController, {
  replace: {
    list: customListHandler,        // overrides productController.list
    bulkDelete: requireAdminGuard,  // overrides bulkDelete
  },
});
```

For validation, the resource can expose a `validation` object with `all`, `create`, `update`, `patch` keys; the framework merges `all` with the per-method schema and binds the validation handlers to the resource.

When you have plain `RequestHandler` functions in a module, prefer `RouteBuilder`. When you have a class-based controller with related methods, `restfulResource` keeps them together.

## Grouping — `group`, `prefix`, `version`

Three composable ways to apply a shared concern to multiple routes.

### `group(options, callback)`

The general form. Options can include a prefix, a name prefix, and an array of middleware:

```ts
router.group(
  {
    prefix: "/admin",
    name: "admin",
    middleware: [authMiddleware(), requireRoleMiddleware("admin")],
  },
  () => {
    router.get("/users", listUsers);          // GET /admin/users, name: "admin.users"
    router.post("/users", createUser);        // POST /admin/users, name: "admin.users.post" (auto-suffixed)
    router.delete("/users/:id", deleteUser);  // DELETE /admin/users/:id, name: "admin.users.:id"
  },
);
```

All three options are optional. The framework collects them onto a stack — nested groups inherit and extend:

```ts
router.group({ prefix: "/v1" }, () => {
  router.group({ prefix: "/auth", middleware: [authMiddleware()] }, () => {
    router.post("/login", login);     // POST /v1/auth/login, middleware: [authMiddleware]
  });
});
```

After the callback returns, the framework pops the stack — subsequent route registrations outside the group don't inherit the options.

### `prefix(prefix, callback)`

Shorthand for `group({ prefix }, callback)` — just the prefix, no middleware or name:

```ts
router.prefix("/api/v1", () => {
  router.get("/users", listUsers);     // GET /api/v1/users
  router.get("/products", listProducts);
});
```

### `version(version, callback)`

Shorthand for `prefix("/v<version>", callback)` — opinionated about the `/v` prefix:

```ts
router.version("1", () => {
  router.get("/users", listUsersV1);    // GET /v1/users
});

router.version("2", () => {
  router.get("/users", listUsersV2);    // GET /v2/users
});
```

Accepts a string or number. The version prefix is always `/v<value>` — no underscores, no other separators.

### Middleware composition order

When a route inherits group middleware AND declares its own:

```ts
router.group({ middleware: [middlewareA, middlewareB] }, () => {
  router.get("/foo", handler, { middleware: [middlewareC] });
});
```

The default execution order is **group first, then route**:

```
middlewareA → middlewareB → middlewareC → handler
```

Set `middlewarePrecedence: "before"` on the route to flip:

```ts
router.get("/foo", handler, {
  middleware: [middlewareC],
  middlewarePrecedence: "before",   // now: C → A → B → handler
});
```

The two cases for "before": when a route-specific middleware must run before any group-level auth (rare), or when the route's middleware is a short-circuit you want to evaluate before paying for the group's setup work.

## Named routes and `getRoute`

Every registered route has a name — explicit (via `options.name`) or auto-generated from the path:

```
router.get("/products/:id", showProduct);      // name: "products.:id"
router.post("/products", createProduct);        // name: "products"
```

When you register the same name twice (same path, different verbs), the framework auto-suffixes with the lowercased method:

```ts
router.get("/products", listProducts);          // name: "products"
router.post("/products", createProduct);        // name: "products.post"
```

Two registrations of the SAME name + method throws:

```
Error: Route name "products.list" already exists
```

`getRoute(name, params?)` resolves a name to a URL path, substituting params. Give the route an explicit `name` so you have a stable handle to resolve against — the auto-generated name keeps the raw `:param` segment (`"products.:id"`), which is awkward to reference:

```ts
router.get("/products/:id", showProduct, { name: "products.show" });

const path = router.getRoute("products.show", { id: "abc-123" });
// → "/products/abc-123"
```

Useful for generating redirect targets, email links, or any cross-route reference where you'd otherwise hardcode `/products/${id}`.

## Static routes — order matters

When a static path overlaps with a parameter path, **the more specific path must be registered first**:

```ts
// ✅ specific first
router.get("/products/featured", showFeatured);
router.get("/products/:id", showProduct);

// ❌ parameter first — `/products/featured` will match `:id` with id="featured"
router.get("/products/:id", showProduct);
router.get("/products/featured", showFeatured);
```

The router walks registered routes in order — find-my-way (the underlying matcher) prefers static segments, but you cannot rely on that when both a static and a param exist at the same depth. Treat ordering as load-bearing.

## Redirects

```ts
router.redirect("/old", "/new");                     // 302 temporary (default)
router.redirect("/old", "/new", "permanent");        // 301 permanent
```

A redirect is implemented as a `GET` route that calls `response.redirect(...)`. The `mode` argument decides the status code — `"temporary"` (302) or `"permanent"` (301).

For redirects that need to pass through query strings, custom logic, or multiple methods, write a regular route with a `response.redirect(...)` body — `router.redirect` is for the trivial case.

## Static file serving

Four shapes for serving static content.

### `directory(options)` — a whole folder

```ts
router.directory({
  root: Application.publicPath,
  prefix: "/static",
});
```

Backed by `@fastify/static`. Every file in `root` becomes reachable under `prefix`. The full `FastifyStaticOptions` surface applies — `decorateReply`, `index`, `dotfiles`, `serve`, `wildcard`, etc.

The framework collects `directory(...)` calls during route registration and replays them when the router scans (so they register against Fastify at scan time, not registration time).

### `file(path, location, cacheTime?)` — single file

```ts
router.file("/favicon.ico", "public/favicon.ico");
router.file("/robots.txt", "public/robots.txt");
```

Serves one file at one URL. `cacheTime` (in seconds) sets `Cache-Control: public, max-age=<value>`.

### `cachedFile(path, location, cacheTime?)` — single file, long cache

Same as `file` but defaults to a one-year cache header. Use for fingerprinted assets that won't change for the life of the deploy:

```ts
router.cachedFile("/app.css", "dist/app.5f3a91.css");
```

### `files(map, cacheTime?)` and `cachedFiles(map, cacheTime?)` — batch

```ts
router.files({
  "/favicon.ico": "public/favicon.ico",
  "/robots.txt": "public/robots.txt",
});

router.cachedFiles({
  "/app.css": "dist/app.5f3a91.css",
  "/app.js": "dist/app.5f3a91.js",
});
```

Convenience for registering many at once.

## Proxy

`router.proxy(...)` registers an outbound HTTP proxy via `@fastify/http-proxy`. Two call shapes:

### Shorthand — path + upstream

```ts
router.proxy("/legacy", "https://old-api.example.com", {
  // additional FastifyHttpProxyOptions, except prefix and upstream
});
```

Every request under `/legacy/...` is forwarded to `https://old-api.example.com/...`.

### Full options form

```ts
router.proxy({
  prefix: "/legacy",
  upstream: "https://old-api.example.com",
  // all FastifyHttpProxyOptions
});
```

Use this when you need access to options not in the shorthand (rewriting headers, websocket support, custom HTTP agents).

Proxy registration is deferred to scan time via `beforeScanning(...)` — it happens after every route is collected but before Fastify binds them.

## Scan hooks

The router scans (registers with Fastify) on HTTP boot. Two hooks let you wedge code in:

```ts
router.beforeScanning((router, server) => {
  // Runs before route registration. Use to register Fastify plugins
  // that need to be in place before routes are bound.
});

router.afterScanning((router, server) => {
  // Runs after every route is bound. Use for catch-all routes,
  // diagnostics, or post-registration introspection.
});
```

Both callbacks receive the router instance and the Fastify server. Multiple registrations queue — the framework calls them in registration order.

A typical use case: the proxy method registers a `beforeScanning` callback under the hood so the proxy plugin is added at the right moment.

## `list()` — every registered route

```ts
const routes = router.list();

routes.forEach((route) => {
  console.log(route.method, route.path, route.name);
});
```

Returns the internal `Route[]` array. Each entry has `method`, `path`, `handler`, `name`, `middleware`, `sourceFile` (for HMR), and more. Use for diagnostics, route table dumps, or generating OpenAPI specs.

## A real example end-to-end

The reference codebase's `faqs` routes — five RESTful endpoints, one guarded group, all in seventeen lines:

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

`guarded(...)` is a project-level helper that wraps the callback in `router.group({ middleware: [authMiddleware("user")] }, ...)` — every route inside it requires an authenticated user.

The companion routes for auth itself, mixing public and guarded:

```ts title="src/app/auth/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { forgotPassword } from "./controllers/forgot-password.controller";
import { login } from "./controllers/login.controller";
import { logout } from "./controllers/logout.controller";
import { me } from "./controllers/me.controller";

router.prefix("/auth", () => {
  router.post("/login", login);              // public
  router.post("/forgot-password", forgotPassword);  // public

  guarded(() => {
    router.post("/logout", logout);          // requires auth
    router.get("/me", me);                   // requires auth
  });
});
```

The `prefix("/auth", ...)` and nested `guarded(...)` compose cleanly — every guarded route inside picks up BOTH the `/auth` prefix and the auth middleware. That's the group-stacking story in action.

The `guarded` helper itself:

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

export function guardedAdmin(callback: () => void) {
  router.group(
    {
      prefix: "/admin",
      middleware: [authMiddleware()],
    },
    callback,
  );
}
```

This is the convention every Warlock module follows — `guarded(...)` for routes that need a logged-in user, `guardedAdmin(...)` for routes that also need the `/admin` prefix.

## Gotchas

- **Static-vs-param order matters.** `router.get("/products/:id", ...)` registered before `router.get("/products/featured", ...)` will match `featured` as the param. Register specific routes first.
- **Each verb can be registered once per `RouteBuilder`.** The builder tracks which verbs you've added — second `.get(...)` throws. To register multiple GETs on the same path... well, you can't. Use `route()` for distinct paths.
- **Group middleware default is `"after"`.** Route-specific middleware runs AFTER group middleware. Flip with `middlewarePrecedence: "before"` if you need pre-auth logic.
- **`route.name` clashes throw at registration time.** If you name a route explicitly and the name is already taken (same method), boot fails. Default auto-generated names auto-suffix on the second registration, so clashes only happen with explicit names.
- **Static files and proxy registrations are deferred to scan time.** They don't bind until HTTP scans the router — which happens AFTER `routes.ts` files load. If you need to introspect static or proxy routes between registration and scan, use `beforeScanning(...)`.
- **`router.any(...)` is rarely what you want.** It registers under every method including `OPTIONS`, `HEAD`, and `TRACE`. Usually you want `get` + `post` + `put` + `delete` explicitly so the OPTIONS preflight doesn't go through your business logic.
- **`router.list()` returns the LIVE array.** Mutations to the returned routes change the router's state. Treat it as read-only or `.slice()` before iterating with side effects.
- **HMR replays route registrations.** When a `routes.ts` file changes in dev, the framework removes its previous routes (by `sourceFile`) and re-imports the file. This works only because the source-file tracking is automatic — don't call `withSourceFile(...)` yourself.

## See also

- **[Routing](./02-routing.md)** — the basics: singleton, params, groups, RESTful chain.
- **[Middleware](./middleware.md)** — what middleware functions look like and how they short-circuit.
- **[RESTful](./restful.md)** — `restfulResource(...)` and the class-based controller pattern in depth.
- **[HTTP Request](./http-request.md)** — the `request` object and what's available inside a handler.
- **[HTTP Response](./http-response.md)** — every `response.<helper>` and streaming / file-download / SSE.
