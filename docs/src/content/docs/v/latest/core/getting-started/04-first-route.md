---
title: "Your first route"
description: Scaffold a CRUD module, run the migration, hit the route — the working hello world for Warlock.
sidebar:
  order: 4
  label: "First route"
---

This is the page where Warlock actually does something. By the end you'll have a working `GET /products` returning JSON — and a full create/read/update/delete stack underneath it that you didn't have to write.

## Step 1 — Scaffold the module

```bash
yarn warlock generate.module products
```

One command. That's it. The full CRUD scaffold is the default, so this lays down the entire feature module under `src/app/products/`:

```
src/app/products/
  controllers/
    create-product.controller.ts
    update-product.controller.ts
    list-products.controller.ts
    get-product.controller.ts
    delete-product.controller.ts
  services/                  ← one *.service.ts per controller
  models/
    product/
      product.model.ts
      index.ts
      migrations/             ← migration file is generated, not applied
  repositories/
    products.repository.ts
  resources/
    product.resource.ts
  schema/                     ← @warlock.js/seal schemas (NOT "validation/")
    create-product.schema.ts
    update-product.schema.ts
  seeds/
    products.seed.ts
  events/                     ← any .ts(x) file here is auto-loaded
  types/
  utils/
    locales.ts                ← groupedTranslations("products", { ... })
  routes.ts                   ← auto-loaded, pre-wired with the 5 CRUD routes
  main.ts                     ← auto-loaded once on boot
```

The framework auto-loads `routes.ts`, `main.ts`, every `.ts(x)` in `events/`, and `utils/locales.ts` — never `import` them by hand. The plural is derived automatically: `generate.module product` and `generate.module products` both produce `src/app/products/`.

To skip the CRUD bootstrap and start with just empty subfolders + a blank `routes.ts`, pass `--minimal` (`-m`). Use that when you'd rather build the module piece by piece with `generate.controller`, `generate.model`, etc.

## Step 2 — Look at the routes file

`src/app/products/routes.ts` is already wired:

```ts title="src/app/products/routes.ts (generated)"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { createProductController } from "./controllers/create-product.controller";
import { deleteProductController } from "./controllers/delete-product.controller";
import { getProductController } from "./controllers/get-product.controller";
import { listProductsController } from "./controllers/list-products.controller";
import { updateProductController } from "./controllers/update-product.controller";

guarded(() => {
  router
    .route("/products")
    .list(listProductsController)
    .show(getProductController)
    .create(createProductController)
    .update(updateProductController)
    .destroy(deleteProductController);
});
```

The RESTful chain expands to the five standard endpoints — all behind the `guarded(...)` wrapper from `app/shared/utils/router`, which applies your auth middleware:

| Verb     | Path             | Controller                  |
| -------- | ---------------- | --------------------------- |
| `GET`    | `/products`      | `listProductsController`    |
| `GET`    | `/products/:id`  | `getProductController`      |
| `POST`   | `/products`      | `createProductController`   |
| `PUT`    | `/products/:id`  | `updateProductController`   |
| `DELETE` | `/products/:id`  | `deleteProductController`   |

If you want this route public, swap `guarded(() => { ... })` for plain calls on `router` directly.

## Step 3 — Run the migration

The scaffold *created* the migration file under `models/product/migrations/` but didn't apply it. Run it now:

```bash
yarn warlock migrate
```

That creates the `products` table in your database.

## Step 4 — Hit it

```bash
curl http://localhost:3000/products
```

```json
{
  "data": [],
  "pagination": { ... }
}
```

The list endpoint returns an empty paginated payload — no rows yet. Either seed some data via `seeds/products.seed.ts` and run `yarn warlock seed`, or `POST /products` with a body matching `createProductSchema`.

## What got generated, briefly

- **Controllers** — thin request handlers. Each is just a function with `(request, response) => …` and an optional `.validation` property attached.
- **Services** — the business logic. Controllers delegate here so the same operation can be reused (e.g. from a CLI command or a background job).
- **Repository** (`repositories/products.repository.ts`) — model-level data access. Exposes `list`, `get`, `create`, etc.
- **Schemas** (`schema/`) — `@warlock.js/seal` validation. Each `.schema.ts` exports both the schema value AND its inferred type:

```ts title="src/app/products/schema/create-product.schema.ts (generated, with your fields filled in)"
import { v, type Infer } from "@warlock.js/seal";

export const createProductSchema = v.object({
  // TODO: add fields
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

- **Resource** (`resources/product.resource.ts`) — wire-format output mapping. Strips internal fields, renames keys, formats dates.
- **Model** (`models/product/product.model.ts`) — `@warlock.js/cascade` model that maps to the `products` table.

## Customize the list controller

Open the generated list controller — it delegates to the service:

```ts title="src/app/products/controllers/list-products.controller.ts (generated)"
import { type RequestHandler } from "@warlock.js/core";
import { listProductsService } from "../services/list-products.service";

export const listProductsController: RequestHandler = async (request, response) => {
  const { data, pagination } = await listProductsService(request.all());

  return response.success({ data, pagination });
};
```

For a quick smoke-test, swap the body for hard-coded data so you can confirm the wire-up without touching the database:

```ts title="src/app/products/controllers/list-products.controller.ts"
import type { RequestHandler } from "@warlock.js/core";

const sampleProducts = [
  { id: 1, name: "Hat", price: 19.99 },
  { id: 2, name: "Hoodie", price: 49.99 },
];

export const listProductsController: RequestHandler = async (request, response) => {
  return response.success({ products: sampleProducts });
};
```

The signature is the same for every controller in Warlock:

- **`request`** — incoming request. Use `request.input("key")` for one field, `request.all()` for the full map, `request.validated()` once a schema is attached.
- **`response`** — outgoing reply. Pick a helper that matches the outcome: `response.success(...)`, `response.successCreate(...)` (201), `response.badRequest(...)`, `response.notFound(...)`, etc.

Save. The dev server detects the change, reloads the affected module, and the new behavior is live. Re-hit `GET /products` and you'll get the hard-coded payload.

No class to extend, no decorators, no DI container.

## Adding validation to a new controller

The CRUD scaffold already wires `create-product` and `update-product` to their schemas. When you add a *new* controller outside that flow, attach a schema by hand.

Create the schema:

```ts title="src/app/products/schema/publish-product.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const publishProductSchema = v.object({
  publishedAt: v.date(),
});

export type PublishProductSchema = Infer<typeof publishProductSchema>;
```

Then on the controller — type its handler as `RequestHandler<Request<PublishProductSchema>>` and attach the schema as a property on the function:

```ts title="src/app/products/controllers/publish-product.controller.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import {
  type PublishProductSchema,
  publishProductSchema,
} from "../schema/publish-product.schema";

export const publishProductController: RequestHandler<Request<PublishProductSchema>> = async (
  request,
  response,
) => {
  const data = request.validated();

  // …mark product published, then:
  return response.success({ published: data });
};

publishProductController.validation = {
  schema: publishProductSchema,
};
```

Two things to notice:

1. `request.validated()` returns the schema-typed object (`PublishProductSchema`). If the request fails validation, the controller never runs — Warlock returns a 400 with an `errors` payload before invoking the handler.
2. `controller.validation = { schema }` is the wiring. The handler is a function; the schema is metadata on it. No decorators required.

For routes behind `authMiddleware`, swap the annotation to `GuardedRequestHandler<PublishProductSchema>` (from `app/auth/types/guarded-request.type`) — `request.user` becomes typed in the body.

## What you've learned

- `generate.module <name>` lays down the entire CRUD scaffold by default — controllers, services, model, repository, resource, schemas, seed, and a pre-wired `routes.ts`. Pass `--minimal` (`-m`) for a skeleton.
- The schema folder is `schema/`, not `validation/`.
- `routes.ts` is auto-loaded and never imported — same for `main.ts`, `events/*`, and `utils/locales.ts`.
- Controllers are thin functions with one signature; they read from `request`, return via `response`.
- Validation is typed end-to-end — the schema doubles as the TypeScript type for `request.validated()`.

## Next

Continue to **[Project layout](./05-project-layout.md)** to learn the full module convention and where every kind of file goes.
