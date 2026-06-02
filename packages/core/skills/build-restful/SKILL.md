---
name: build-restful
description: 'Generate standard CRUD endpoints — via `router.route(path).list().show().create().update().destroy()` chain or the `Restful` base class. Pick the chain by default; reach for `Restful` when you want repository-bound defaults. Triggers: `router.route`, `Restful`, `router.restfulResource`, `RouteResource`, `.crud`, `.nest`, `beforeCreate`, `onCreate`; "build a CRUD API", "register list/show/create/update/destroy", "repository-bound default handlers", "override a single REST action"; typical import `import { router, Restful } from "@warlock.js/core"`. Skip: wider router surface — `@warlock.js/core/register-route/SKILL.md`; per-action controllers — `@warlock.js/core/create-controller/SKILL.md`; wire mapping — `@warlock.js/core/define-resource/SKILL.md`; competing pattern: hand-rolled controllers, `@nestjs/swagger` decorator-driven CRUD.'
---

# Warlock — build a RESTful resource

Standard CRUD comes in two flavors. The **router chain** is thin: you write one controller per action and chain them via `router.route(path)`. The **`Restful` base class** is thick: it wires a repository to default handlers — list/get/create/update/patch/delete plus bulkDelete — and you override hooks only where you need to.

## The shape

```ts title="src/app/<module>/routes.ts"
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

This is the project default. Five controllers, one chain, auto-loaded.

## The chain — `router.route(path)`

`router.route(path)` returns a `RouteBuilder`. Each named slot maps to a verb + path:

| Method                                | Verb     | Path        |
| ------------------------------------- | -------- | ----------- |
| `.list(handler)`                      | `GET`    | `/path`     |
| `.show(handler)`                      | `GET`    | `/path/:id` |
| `.create(handler)`                    | `POST`   | `/path`     |
| `.update(handler)`                    | `PUT`    | `/path/:id` |
| `.patch(handler)`                     | `PATCH`  | `/path/:id` |
| `.destroy(handler)`                   | `DELETE` | `/path/:id` |
| `.get(handler)`                       | `GET`    | `/path`     |
| `.post(handler)`                      | `POST`   | `/path`     |
| `.put(handler)`                       | `PUT`    | `/path`     |
| `.delete(handler)`                    | `DELETE` | `/path`     |
| `.getOne` / `.postOne` / `.deleteOne` | verb     | `/path/:id` |

The semantic aliases (`list`, `show`, `create`, `update`, `destroy`, `patch`) are just thin wrappers — same registration. Methods you don't call don't register. Each method returns the builder, so you chain.

### `.crud({...})`

Sugar for setting up all six slots in one call:

```ts
router.route("/products").crud({
  list: listProductsController,
  show: getProductController,
  create: createProductController,
  update: updateProductController,
  destroy: removeProductController,
  patch: patchProductController,
});
```

### `.nest(path)`

For nested resources like `/posts/:id/comments`:

```ts
router
  .route("/posts/:id")
  .show(showPostController)
  .nest("/comments")
  .list(listCommentsController)
  .create(createCommentController);
```

## The `Restful` base class

When you want default CRUD handlers wired straight to a repository, extend `Restful<T>`:

```ts
import { Restful, type RouteResource, v } from "@warlock.js/core";
import { UsersRepository } from "./repositories/users.repository";
import type { User } from "./models/user/user.model";

export class UsersRestful extends Restful<User> implements RouteResource {
  protected repository = new UsersRepository();

  protected recordName = "user";
  protected recordsListName = "users";

  public cache = true;

  protected returnOn = {
    create: "record",
    update: "record",
    delete: "record",
    patch: "record",
  };

  public validation = {
    create: {
      schema: v.object({
        name: v.string().required().min(2),
        email: v.email().required(),
      }),
    },
    update: {
      schema: v.object({
        name: v.string().min(2),
      }),
    },
  };
}

// `validation` is consumed via duck-typing by `router.restfulResource()`.
// The base `Restful` class doesn't formally declare it — you add it on the
// subclass and the router picks it up at registration time.
```

Wire it to the router via `router.restfulResource(path, instance, options?)`:

```ts
import { router } from "@warlock.js/core";

router.restfulResource("/users", new UsersRestful());
```

This registers:

| Path        | Verb     | Method        |
| ----------- | -------- | ------------- |
| `/users`    | `GET`    | `list()`      |
| `/users/:id`| `GET`    | `get()`       |
| `/users`    | `POST`   | `create()`    |
| `/users/:id`| `PUT`    | `update()`    |
| `/users/:id`| `PATCH`  | `patch()`     |
| `/users/:id`| `DELETE` | `delete()`    |
| `/users`    | `DELETE` | `bulkDelete()`|

`bulkDelete` expects an array of ids in the `id` field; it 400s otherwise. All actions except `bulkDelete` only register when the corresponding method is defined on the class — `Restful` provides them all by default.

### Filtering registered actions

```ts
router.restfulResource("/users", new UsersRestful(), {
  only: ["list", "get"],
});

router.restfulResource("/users", new UsersRestful(), {
  except: ["delete"],
});

router.restfulResource("/users", new UsersRestful(), {
  replace: {
    create: customCreateHandler,
  },
});
```

`replace` overrides a single action without rebuilding the class. `only` and `except` filter the action set.

### Configurable bits on `Restful`

- `recordName` / `recordsListName` — response keys for `{ [recordName]: model }` and `{ [recordsListName]: [...] }`. Default `"record"` and `"records"`.
- `returnOn` — after create/update/delete/patch, return the single record (default) or the full list (`"records"`).
- `cache` — when `true` (default), `list()` and `get()` use the repository's cached variants (`listCached`/`getCached`).
- `validation` — per-action schemas read by `router.restfulResource()`. Add `validation = { create?, update?, patch? }` as a public field on your subclass; the router consumes whichever entries exist. The field isn't declared on the base `Restful` class — it's duck-typed off the resource at registration time (see `router.ts > manageValidation`).

### Lifecycle hooks

Override any of these `protected async` methods:

| Hook                            | When                                      |
| ------------------------------- | ----------------------------------------- |
| `beforeCreate(request, response, model)` | New model instance, before `create`       |
| `onCreate(request, response, record)`    | After successful `create`                 |
| `beforeUpdate(request, response, record, old?)` | Before `update`                    |
| `onUpdate(request, response, record, old)`      | After successful `update`           |
| `beforePatch(request, response, record, old?)`  | Before `patch`                      |
| `onPatch(request, response, record, old)`       | After successful `patch`            |
| `beforeDelete(request, response, record)`       | Before `delete` (single + bulk)     |
| `onDelete(request, response, record)`           | After successful `delete`           |
| `beforeSave(request, response, record?, old?)`  | Before create/update/patch — shared |
| `onSave(request, response, record, old?)`       | After create/update/patch — shared  |

Returning a response from a `before*` hook short-circuits the action. Use for permission checks or computed-field assignment.

## When to use which

- **Default to the chain (`router.route(...)`)** with explicit per-action controllers — every module in the project uses this. Controllers stay thin, services own the logic, validation lives on the controller, and you can read `routes.ts` in five seconds.
- **Reach for `Restful`** when the entity is genuinely vanilla CRUD against a repository with no per-action service variation. The hook ladder is more ceremony than five controllers if the actions diverge at all.
- **Drop to hand-rolled controllers** when even one action breaks the CRUD shape — custom response wrappers, multi-step pipelines, non-`:id` lookups. Mixing is fine: chain the standard four, register the oddball as a separate `router.post(...)`.

## Common patterns

### Project default — five controllers behind a chain

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

### Public list + guarded mutations

```ts
router.prefix("/products", () => {
  router.get("/", listProductsController);

  guarded(() => {
    router.post("/", createProductController);
    router.patch("/:id", updateProductController);
    router.delete("/:id", removeProductController);
  });
});
```

### Restful with override

```ts
class OrdersRestful extends Restful<Order> {
  protected repository = new OrdersRepository();
  protected recordName = "order";

  protected async beforeCreate(request, response, order) {
    order.set("organization_id", request.user.organizationId);
    order.set("created_by", request.user.id);
  }
}

router.restfulResource("/orders", new OrdersRestful());
```

## Gotchas

- **`router.restfulResource` wraps `prefix(path, ...)` internally** — register inside `guarded(...)` to guard the whole set, or pass middleware via the options. Avoid registering the same prefix twice.
- **`Restful.update` is `PUT`, `Restful.patch` is `PATCH`.** They differ — `update` uses `request.allExceptParams()`, `patch` uses `request.heavyExceptParams()`. Don't conflate them.
- **`cache = true` reuses repository cache.** If the repository isn't cacheable, the cached methods silently fall through to the live query — set `cache = false` explicitly if you want to make that visible.
- **`bulkDelete` reads `id` as an array.** The route is `DELETE /path` (no `:id`); send `id: ["1", "2", "3"]` in the body. Returns 400 if the value isn't an array.
- **Validation hooks on `Restful`** are bound to the instance — call `this.repository` freely inside `validate()`. Plain controller validators don't get `this`.
- **Don't import `routes.ts`.** Framework auto-loads it. See `register-route` for the rules.

## See also

- [`register-route/SKILL.md`](../register-route/SKILL.md) — the wider router surface (`group`, `prefix`, plain verbs).
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — what the chain's handlers look like.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — wire shape for the records the chain returns.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — controller/service/repository layering rules.
