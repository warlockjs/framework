---
title: "Restful"
description: Two ways to wire CRUD endpoints — the chainable router.route() builder for action handlers, and the Restful class for whole-resource controllers with lifecycle hooks.
sidebar:
  order: 14
  label: "Restful"
---

Warlock gives you two ways to wire the standard CRUD route quintet — `list / show / create / update / destroy` — without writing the same routing boilerplate per module. Pick the one that fits the module's shape:

- **`router.route(path).list().show().create().update().destroy()`** — the chainable builder. One controller function per action. The default in the reference codebase.
- **`class XRestful extends Restful` + `router.restfulResource(...)`** — a single class that owns all five actions, repository, lifecycle hooks. Lighter wiring at the cost of less per-action control.

This page covers both, when to prefer each, and the full surface of the `Restful` class.

## The chainable builder

`router.route(path)` returns a `RouteBuilder`. Chain RESTful action methods to declare the route shape:

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

That declares five routes:

| Method   | Path        | Handler                |
| -------- | ----------- | ---------------------- |
| `GET`    | `/faqs`     | `listFaqsController`   |
| `GET`    | `/faqs/:id` | `getFaqController`     |
| `POST`   | `/faqs`     | `createFaqController`  |
| `PUT`    | `/faqs/:id` | `updateFaqController`  |
| `DELETE` | `/faqs/:id` | `deleteFaqController`  |

Every action is its own controller — its own file, its own validation schema, its own permissions check via middleware. The five handlers fit the standard controller shape (`(request, response) => Promise<...>`), and the routing layer wires them together.

### Action aliases

The builder exposes the RESTful aliases alongside the HTTP verbs. They mean the same things — pick the names that read cleanest:

| Alias       | Equivalent HTTP method  | Path adjustment    |
| ----------- | ----------------------- | ------------------ |
| `.list()`   | `.get()`                | `path`             |
| `.show()`   | `.getOne()`             | `path + "/:id"`    |
| `.create()` | `.post()`               | `path`             |
| `.update()` | `.updateOne()` / `.put()` | `path + "/:id"` |
| `.destroy()`| `.deleteOne()` / `.delete()` | `path + "/:id"` |
| `.patch()`  | (`PATCH path`)          | `path`             |
| `.patchOne()` | (`PATCH path/:id`)    | `path + "/:id"`    |

The `RouteBuilder` enforces "one verb per path" — calling `.get(...)` twice on the same route throws. Use `.list()` and `.show()` for the GET pair (different paths) instead.

### The CRUD shortcut

If your routes are a perfect five-action CRUD, the `.crud({...})` shortcut sets all five at once:

```ts
router.route("/products").crud({
  list: listProductsController,
  show: showProductController,
  create: createProductController,
  update: updateProductController,
  destroy: deleteProductController,
  patch: patchProductController,  // optional
});
```

Each key is optional — only the routes you pass get wired.

### Nesting

`.nest(suffix)` returns a new `RouteBuilder` rooted at the combined path:

```ts title="src/app/catalog-items/routes.ts"
router
  .route("/catalog-items")
  .list(listCatalogItemsController)
  .show(getCatalogItemController)
  .create(createCatalogItemController)
  .update(updateCatalogItemController)
  .destroy(deleteCatalogItemController)
  .nest("/:id/summary")
    .get(getCatalogItemSummaryController)
    .post(summarizeCatalogItemController)
    .patch(approveCatalogItemSummaryController)
    .delete(deleteCatalogItemSummaryController);
```

The nested chain declares `GET/POST/PATCH/DELETE /catalog-items/:id/summary` on the same builder. Use this when a resource has sub-routes that aren't another CRUD set.

### Per-route options

Every chain method accepts a `RouteOptions` second argument:

```ts
router
  .route("/products")
  .list(listProductsController, {
    middleware: [requireRole("admin")],
    rateLimit: { max: 60, timeWindow: 60000 },
  })
  .create(createProductController, {
    middleware: [requireRole("manager")],
  });
```

Per-action middleware and rate limits — same surface as the underlying `router.get/post/...` methods.

### When to use the chainable builder

This is the default pattern in the reference codebase and what most modules look like. Reach for it when:

- Each action has its own controller (separate files, separate validation schemas, separate concerns).
- You want per-action middleware (admin-only delete, public list).
- You want per-action response shaping — list returns paginated data, show returns one record, create returns 201.
- You like the explicit "one controller, one action" mental model.

The five-file controller split is a tiny amount of boilerplate, and it pays back the moment one of the actions needs to differ from the rest.

## The `Restful` class

The class form bundles all five actions into one place. You set a repository, and the framework generates the handlers from it:

```ts title="src/app/products/restful/products.restful.ts"
import { Restful } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { Product } from "../models/product";
import { productsRepository } from "../repositories/products.repository";

class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  protected recordName = "product";
  protected recordsListName = "products";

  // Optional — validation per action
  public validation = {
    create: {
      schema: v.object({
        name: v.string(),
        price: v.number().min(0),
      }),
    },
    update: {
      schema: v.object({
        name: v.string().optional(),
        price: v.number().min(0).optional(),
      }),
    },
  };
}

export const productsRestful = new ProductsRestful();
```

Then wire it into the router:

```ts title="src/app/products/routes.ts"
import { router } from "@warlock.js/core";
import { productsRestful } from "./restful/products.restful";

router.restfulResource("/products", productsRestful);
```

That single call generates the same five routes the chainable builder would:

```
GET     /products
GET     /products/:id
POST    /products
PUT     /products/:id
PATCH   /products/:id
DELETE  /products/:id
DELETE  /products       (bulk delete, if implemented)
```

The handlers come from the class — `productsRestful.list`, `productsRestful.get`, etc. — and the repository owns the actual data access.

### The default handlers

`Restful<T>` ships with seven public methods. Each is the default implementation for one route action.

| Method         | Generated route         | What it does                                                                   |
| -------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `list`         | `GET  path`             | Calls `repository.list[Cached]` and returns `{ records, pagination }`.        |
| `get`          | `GET  path/:id`         | Calls `find(id)`; 404 if missing.                                              |
| `create`       | `POST path`             | Calls `repository.create(request.all())`. Returns 201 + the record.            |
| `update`       | `PUT  path/:id`         | Loads, saves with `request.allExceptParams()`, returns the updated record.     |
| `patch`        | `PATCH path/:id`        | Loads, saves with `request.heavyExceptParams()`, returns the patched record.   |
| `delete`       | `DELETE path/:id`       | Loads, calls `record.destroy()`, returns empty success.                        |
| `bulkDelete`   | `DELETE path`           | Bulk delete from `request.input("id")` array. Returns `{ deleted: count }`.   |

All seven exist on the base `Restful` class — `router.restfulResource(...)` generates a route for any of them the class exposes. The framework picks based on the presence of each method on the resource you pass.

### Validation

The class declares validation in a `validation` property — per action or shared:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  public validation = {
    // Applied to create + update + patch
    all: {
      schema: v.object({
        name: v.string(),
        price: v.number().min(0),
      }),
    },
    // Add to / override per action
    create: {
      schema: v.object({
        category_id: v.string(),
      }),
      validate: async (request, response) => {
        // Custom validation runs after schema. Return a response to abort.
      },
    },
    update: {
      // Same shape as create.
    },
    patch: {
      // Same shape.
    },
  };
}
```

When both `all` and a per-action schema exist, the framework merges them — `all` is the base, the action-specific keys win.

`validate` is a custom middleware that runs alongside the schema. Return a response from it to short-circuit (a 400 with extra detail, for example); return `undefined` to continue.

### Customising response keys

The default response shape uses `record` for one and `records` for many:

```ts
// GET /products/:id
{ "record": { "id": "1", "name": "..." } }

// GET /products
{ "records": [...], "pagination": {...} }
```

To rename them, set `recordName` and `recordsListName`:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;
  protected recordName = "product";
  protected recordsListName = "products";
}
```

Now the API responses use `product` / `products` — which is what the reference codebase pattern looks like.

### Lifecycle hooks

Override any of the protected methods to inject behaviour. The hook fires at well-known moments, receives `(request, response, record, oldRecord?)`, and **returning anything truthy short-circuits the action** — the framework treats it as the response.

| Hook            | Fires                                                                | Use case                                |
| --------------- | -------------------------------------------------------------------- | --------------------------------------- |
| `beforeCreate`  | Before `create` calls the repository                                 | Set defaults, run async validations.    |
| `onCreate`      | After `create` returns                                               | Send notifications, audit.              |
| `beforeUpdate`  | Before `update` saves                                                | Compute derived fields.                 |
| `onUpdate`      | After `update` returns                                               | Invalidate downstream caches.           |
| `beforePatch`   | Before `patch` saves                                                 | Same as update.                         |
| `onPatch`       | After `patch` returns                                                | Same as update.                         |
| `beforeDelete`  | Before `destroy()` runs                                              | Pre-flight cleanup.                     |
| `onDelete`      | After `destroy()` returns                                            | Post-flight cleanup.                    |
| `beforeSave`    | Before any save (create / update / patch)                            | Cross-action setup.                     |
| `onSave`        | After any save (create / update / patch)                             | Cross-action notification.              |

A real shape:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  protected async beforeCreate(request: Request, response: Response, product: Product) {
    product.set("createdBy", request.user.id);
  }

  protected async onCreate(request: Request, response: Response, product: Product) {
    await searchIndex.add(product);
  }

  protected async beforeDelete(request: Request, response: Response, product: Product) {
    if (product.get("status") === "published") {
      return response.badRequest({ error: "Unpublish before deleting" });
      // Returning a response aborts the action.
    }
  }

  protected async onDelete(request: Request, response: Response, product: Product) {
    await searchIndex.remove(product.id);
  }
}
```

The hooks are async by default and the framework awaits them, so you can run real work in them. Don't worry about Promise.all-ing them — the order is sequential by design.

### `returnOn` — list-after-write

A common pattern: after a write, return the **updated list** instead of just the changed record. Configure via `returnOn`:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  protected returnOn: Record<string, "record" | "records"> = {
    create: "records",
    update: "records",
    delete: "records",
    patch: "record",
  };
}
```

Now `POST /products` calls `create()` and immediately responds with the freshly-listed `records` array (running `list()` internally). For an admin UI that re-renders the list after every action, this is one less round trip.

### Limiting which routes are generated

`router.restfulResource(path, resource, options)` accepts `only` and `except`:

```ts
// Just list + show — read-only resource
router.restfulResource("/products", productsRestful, {
  only: ["list", "get"],
});

// Everything except bulkDelete
router.restfulResource("/products", productsRestful, {
  except: ["delete"],   // also excludes bulkDelete
});
```

And `replace` for swapping a specific action with a custom handler while keeping the rest:

```ts
import { customListHandler } from "./controllers/custom-list.controller";

router.restfulResource("/products", productsRestful, {
  replace: {
    list: customListHandler,
  },
});
```

The `replace.list` runs instead of `productsRestful.list` — useful when one action diverges enough to write by hand but the rest fit the class.

### Caching

`Restful` honours the repository's cache by default — `list` calls `listCached`, `get` calls `getCached`. Toggle it via the `cache` property:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  public cache = false;  // hit the database directly on every read
}
```

Useful when the data churns faster than the cache TTL, or when the resource gets enough writes that the cache hit rate isn't worth the freshness lag.

### Middleware per action

The class has a protected `middleware: RestfulMiddleware` slot. The shape is `Record<action, [Middleware]>`:

```ts
class ProductsRestful extends Restful<Product> {
  protected repository = productsRepository;

  protected middleware = {
    list: [publicCacheHeader],
    create: [requireRole("manager")],
    update: [requireRole("manager")],
    delete: [requireRole("admin")],
  };
}
```

Middleware here runs from the action handler itself (via `callMiddleware`). Route-level middleware on `router.restfulResource(...)` runs first; this runs after.

## When to prefer each

| Pattern                          | When it fits                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| **Chainable builder**            | Most modules. Each action has its own controller file. The reference codebase default.        |
| **`Restful` class**              | Internal admin endpoints. A CRUD module that's truly five identical-shaped actions over one repository, where lifecycle hooks beat per-action controllers. |

The chainable builder wins by default because the indirection cost (one file per action) is small and the upside (each action evolves independently, validation lives next to the controller, permissions are obvious from the route declaration) shows up the moment one action diverges.

The `Restful` class wins when:

- The five actions really are isomorphic — same validation, same response shape, only the lifecycle hook differs per action.
- You want the lifecycle hook pattern (`onCreate`, `onUpdate`) instead of remembering to call a service from each controller.
- You're building an admin / internal CRUD UI where consistency matters more than per-action flexibility.

In the reference codebase, the chainable builder pattern is what's used everywhere — `src/app/faqs/routes.ts`, `src/app/catalog-items/routes.ts`, `src/app/contacts/routes.ts`. The `Restful` class exists for the cases above; reach for it when you find yourself wishing you could skip the five-controller split.

## A real example end-to-end

The reference codebase's FAQs module. Five controllers, one repository, one resource, six lines of routes:

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

`guarded(...)` wraps the route declaration with auth middleware (the route prefix and middleware are applied to every route inside). The chain reads top-to-bottom as "five RESTful actions for `/faqs`, every one requires auth."

The same module via the `Restful` class would collapse the routing file to two lines but spread the validation, the lifecycle hooks, and the response shaping across one bigger class. Pick the shape that fits your team's preferences and the action's actual complexity.

## Gotchas

- **`router.restfulResource(...)` only generates routes for actions the class actually implements.** If `bulkDelete` isn't a method, no `DELETE path` route is wired. The default `Restful` base class implements all seven; subclasses inherit them unless they override.
- **Returning a response from a lifecycle hook aborts the action.** A truthy return value is treated as the framework's response. Return `undefined` (or just no return) to continue.
- **`Restful` actions catch errors internally** and log to `log.error`. For a custom error mapping, override the action method or use the chainable builder where the controller catch-all does the work.
- **Per-action middleware on `restfulResource` applies to every action.** Per-action middleware on the class (`protected middleware`) runs from inside the handler — narrower scope.
- **`request.allExceptParams()` and `request.heavyExceptParams()`** strip the route params (`/:id`) from the body, which is what `update` and `patch` use. If you need the params preserved for a custom hook, read them via `request.input("id")` explicitly.
- **`returnOn: "records"` runs `list()` again** after the write, which means another DB round-trip (or a cache hit). Acceptable for admin UIs, less so for high-traffic APIs.
- **One verb per path on the chainable builder.** `router.route("/x").get(a).get(b)` throws — use `.list(...)` and `.show(...)` instead.
- **The chain order doesn't matter** — `.list().show()` and `.show().list()` produce the same routes. Pick a consistent order (the reference codebase uses list / show / create / update / destroy) and stick to it.

## See also

- **[Repositories (essentials)](./05-repositories.md)** — the data layer the `Restful` class wraps.
- **[Resources (essentials)](./06-resources.md)** — the layer that shapes records on the way out.
- **[Routing](./02-routing.md)** — the underlying `router` surface.
- **[Repositories deep dive](./repositories-deep.md)** — every method the `Restful` class delegates to.
- **[Resources deep dive](./resources-deep.md)** — shaping the records `list` and `get` return.
