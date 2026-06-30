---
title: "Add a CRUD module"
description: Scaffold a complete RESTful module — model, repository, controllers, validation, routes — using `warlock generate.*`, then wire it to a database table you can hit with curl in under ten minutes.
sidebar:
  order: 1
  label: "Add a CRUD module"
---

Every backend has a moment where you need a new resource. A `products` table, `articles`, `tickets`, whatever — they all want the same five endpoints (list, show, create, update, delete) and the same six files (model, migration, repository, schemas, controllers, routes). Warlock's generators give you the skeleton in seconds; this recipe walks the full path from "I have nothing" to "I just curl'd a row I created."

We'll build `products`. Substitute your own name everywhere you see it.

## Step 1 — Scaffold the module

```bash
yarn warlock generate.module products
```

That command creates the module folder with all the standard subdirectories at once:

```
src/app/products/
  controllers/
  services/
  models/
  repositories/
  resources/
  schema/                 ← seal schemas (value + inferred type from one file)
  events/                 ← auto-loaded
  types/
  utils/
  utils/locales.ts
  main.ts
  routes.ts
```

`main.ts` is your one-time setup file (event listeners, registrations). `routes.ts` is the module's public URL surface. Both are auto-loaded — you never `import` them.

Open `routes.ts` and you'll see a stub:

```ts title="src/app/products/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";

// Define your routes here
// Example:
// router.get("/products", listController);
```

We'll come back to it once the controllers exist.

## Step 2 — Generate the model with a resource

```bash
yarn warlock generate.model products/product --with-resource
```

The argument is `<module>/<entity>`. The module is plural (`products`); the entity is singular (`product`). The `--with-resource` flag also drops a resource file under `resources/`.

What lands:

```
src/app/products/
  models/product/
    product.model.ts
    index.ts
    migrations/
  resources/
    product.resource.ts
```

The generated model is a stub — you'll fill in the schema fields:

```ts title="src/app/products/models/product/product.model.ts"
import { Model, type StrictMode } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/seal";
import { ProductResource } from "../../resources/product.resource";

const productSchema = v.object({
  // TODO: Define model schema
});

export type ProductType = Infer.Output<typeof productSchema>;

export class Product extends Model<ProductType> {
  public static table = "products";
  public static strictMode: StrictMode = "fail";
  public static resource = ProductResource;

  public static schema = productSchema;

  public static relations = {
    // TODO: Define relations
  };
}
```

Replace the schema with real fields:

```ts title="src/app/products/models/product/product.model.ts"
import { Model, type StrictMode } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/seal";
import { ProductResource } from "../../resources/product.resource";

const productSchema = v.object({
  name: v.string().min(2).max(120),
  slug: v.string().min(2).max(160),
  price: v.number().min(0),
  description: v.string().optional(),
  in_stock: v.boolean(),
});

export type ProductType = Infer.Output<typeof productSchema>;

export class Product extends Model<ProductType> {
  public static table = "products";
  public static strictMode: StrictMode = "fail";
  public static resource = ProductResource;

  public static schema = productSchema;
}
```

Two notes on what changed:

1. **Dropped `public static relations = {}`** because we don't have any. Cascade infers relations from `@BelongsTo` / `@HasMany` decorators; the empty literal is just generator noise.
2. **Schema fields use `snake_case` for columns that map to DB columns** (`in_stock`). Cascade reads the schema keys verbatim as column names. You can use camelCase if you prefer — pick one convention per project and stick with it.

The resource is even thinner:

```ts title="src/app/products/resources/product.resource.ts"
import { Resource } from "@warlock.js/core";

export class ProductResource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    // TODO: Define resource schema
  };
}
```

Make it match the model:

```ts title="src/app/products/resources/product.resource.ts"
import { Resource } from "@warlock.js/core";

export class ProductResource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    slug: "string",
    price: "number",
    description: "string",
    in_stock: "boolean",
    createdAt: "date",
    updatedAt: "date",
  };
}
```

Resources are output-only — they map model fields to wire fields and nothing else. No hydration, no reconciliation, no computed side effects. Those belong in services or model accessors.

## Step 3 — Write the migration

The generator created the `migrations/` folder but not a migration file. Generate one explicitly with the column DSL:

```bash
yarn warlock generate.migration products/product \
  --add "name:text,slug:text:unique,price:double,description:text:nullable,in_stock:boolean"
```

The `--add` syntax is `name:type:modifier` per column, comma-separated. Common types: `text`, `string`, `int`, `bigInt`, `double`, `boolean`, `timestamp`, `uuid`, `json`. Modifiers include `nullable`, `unique`, and `references` (for foreign keys).

What you get:

```ts title="src/app/products/models/product/migrations/<timestamp>-product.migration.ts"
import { boolean, double, Migration, text } from "@warlock.js/cascade";
import { Product } from "../product.model";

export default Migration.create(Product, {
  name: text().notNullable(),
  slug: text().notNullable().unique(),
  price: double().notNullable(),
  description: text().nullable(),
  in_stock: boolean().notNullable(),
});
```

Run it:

```bash
yarn warlock migrate
```

You should see `products` created. The migration also adds `id`, `createdAt`, `updatedAt`, and `deletedAt` (for soft-delete support) by default — you don't declare those.

## Step 4 — Generate the repository

```bash
yarn warlock generate.repository products/product
```

Output:

```ts title="src/app/products/repositories/products.repository.ts"
import type { FilterByOptions, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { Product } from "../models/product";

type ProductListFilter = {
  // Repository list filters
};

export type ProductListOptions = RepositoryOptions & ProductListFilter;

export class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  protected defaultOptions: RepositoryOptions = this.withDefaultOptions({});

  protected filterBy: FilterByOptions = this.withDefaultFilters({
    name: "like",
  });
}

export const productsRepository = new ProductsRepository();
```

Three knobs to set before this is useful:

```ts title="src/app/products/repositories/products.repository.ts"
import type { FilterByOptions, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { Product } from "../models/product";

type ProductListFilter = {
  ids?: string[];
  id?: string;
  slug?: string;
  in_stock?: boolean;
  search?: string;
};

export type ProductListOptions = RepositoryOptions & ProductListFilter;

export class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  protected defaultOptions: RepositoryOptions = this.withDefaultOptions({
    orderBy: {
      createdAt: "desc",
    },
  });

  protected filterBy: FilterByOptions = this.withDefaultFilters({
    id: "=",
    ids: ["in", "id"],
    slug: "=",
    in_stock: "=",
    search: ["like", "name"],
  });
}

export const productsRepository = new ProductsRepository();
```

- **`filterBy`** — a map of "query-string key" to "(operator, column?)". `["in", "id"]` means `?ids[]=...` filters by `WHERE id IN (...)`. `["like", "name"]` means `?search=foo` becomes `WHERE name LIKE '%foo%'`. `withDefaultFilters(...)` merges your rules on top of the framework defaults.
- **`defaultOptions`** — the default sort. `withDefaultOptions(...)` merges over the framework defaults. Override per-request via `request.input("orderBy")` if you expose it.

## Step 5 — Generate the controllers

Five separate calls, each scoped to one endpoint:

```bash
yarn warlock generate.controller products/list-products
yarn warlock generate.controller products/get-product
yarn warlock generate.controller products/create-product --with-validation
yarn warlock generate.controller products/update-product --with-validation
yarn warlock generate.controller products/remove-product
```

The naming convention: `list-<plural>`, `get-<singular>`, `create-<singular>`, `update-<singular>`, `remove-<singular>` (or `delete-<singular>` — pick one). The `--with-validation` flag also creates a schema in `schema/` — value + inferred type from one file, no separate `*.request.ts`.

What lands per controller:

```
controllers/list-products.controller.ts
controllers/get-product.controller.ts
controllers/create-product.controller.ts
schema/create-product.schema.ts
controllers/update-product.controller.ts
schema/update-product.schema.ts
controllers/remove-product.controller.ts
```

### Wire the list controller

The generator gives you a generic stub. Wire it to the repository:

```ts title="src/app/products/controllers/list-products.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { productsRepository } from "../repositories/products.repository";

export const listProductsController: RequestHandler = async (request, response) => {
  const { data, pagination } = await productsRepository.listCached(request.all());

  return response.success({
    products: data,
    pagination,
  });
};
```

`request.all()` returns every query/body/param input. The repository's `listCached` reads `filterBy` to build a SQL filter from those inputs, hits the cache first, and falls back to the database on miss.

### Wire the get controller

```ts title="src/app/products/controllers/get-product.controller.ts"
import { ResourceNotFoundError, type RequestHandler } from "@warlock.js/core";
import { productsRepository } from "../repositories/products.repository";

export const getProductController: RequestHandler = async (request, response) => {
  const product = await productsRepository.getCached(request.input("id"));

  if (!product) {
    throw new ResourceNotFoundError("Product not found");
  }

  return response.success({ product });
};
```

`request.input("id")` reads the path param the router gave us. `ResourceNotFoundError` extends the framework's `HttpError` — throwing it returns a `404` with a structured body. No need to write `return response.notFound(...)` by hand.

### Wire the create controller

The generator created a schema stub. Replace it with real rules:

```ts title="src/app/products/schema/create-product.schema.ts"
import { type Infer, v } from "@warlock.js/seal";

export const createProductSchema = v.object({
  name: v.string().min(2).max(120),
  slug: v.string().min(2).max(160).unique("Product"),
  price: v.number().min(0),
  description: v.string().optional(),
  in_stock: v.boolean(),
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

`v.string().unique("Product")` is the DB-aware validator from Cascade's seal plugin — it checks the `products` table for an existing row with the same `slug` and fails the schema before the controller runs. Want to scope to non-deleted rows? Pass a `query` callback.

Now the controller — the inferred `CreateProductSchema` type comes from the schema file directly, no separate `*.request.ts` alias:

```ts title="src/app/products/controllers/create-product.controller.ts"
import { type Request, type RequestHandler } from "@warlock.js/core";
import { Product } from "../models/product";
import {
  type CreateProductSchema,
  createProductSchema,
} from "../schema/create-product.schema";

export const createProductController: RequestHandler<Request<CreateProductSchema>> = async (
  request,
  response,
) => {
  const product = await Product.create(request.validated());

  return response.successCreate({ product });
};

createProductController.validation = {
  schema: createProductSchema,
};
```

`request.validated()` returns the schema-typed object. The schema is attached to the controller via the `.validation` property — that's the wiring, no decorators required. `response.successCreate(...)` returns `201`.

For anything richer than a one-liner, extract a service:

```ts title="src/app/products/services/create-product.service.ts"
import { Product } from "../models/product";
import { type CreateProductSchema } from "../schema/create-product.schema";

export async function createProductService(data: CreateProductSchema) {
  return Product.create(data);
}
```

Then the controller becomes:

```ts
const product = await createProductService(request.validated());
```

Thin controllers, fat services. Always.

### Wire the update controller

Update schemas usually mirror create schemas. Reuse with `.without(...)` or `.partial()` depending on what you want:

```ts title="src/app/products/schema/update-product.schema.ts"
import { type Infer } from "@warlock.js/seal";
import { productSchema } from "../models/product";

export const updateProductSchema = productSchema.partial();

export type UpdateProductSchema = Infer<typeof updateProductSchema>;
```

`.partial()` makes every field optional. `.without("slug")` drops a field entirely (you might forbid slug updates). Pick what fits.

The controller:

```ts title="src/app/products/controllers/update-product.controller.ts"
import {
  ResourceNotFoundError,
  type Request,
  type RequestHandler,
} from "@warlock.js/core";
import { Product } from "../models/product";
import {
  type UpdateProductSchema,
  updateProductSchema,
} from "../schema/update-product.schema";

export const updateProductController: RequestHandler<Request<UpdateProductSchema>> = async (
  request,
  response,
) => {
  const product = await Product.find(request.input("id"));

  if (!product) {
    throw new ResourceNotFoundError("Product not found");
  }

  await product.merge(request.validated()).save();

  return response.success({ product });
};

updateProductController.validation = {
  schema: updateProductSchema,
};
```

`product.merge(data)` overlays the partial data on the model; `.save()` persists it. Cascade tracks which columns changed and only writes those.

### Wire the remove controller

```ts title="src/app/products/controllers/remove-product.controller.ts"
import { ResourceNotFoundError, type RequestHandler } from "@warlock.js/core";
import { Product } from "../models/product";

export const removeProductController: RequestHandler = async (request, response) => {
  const product = await Product.find(request.input("id"));

  if (!product) {
    throw new ResourceNotFoundError("Product not found");
  }

  await product.destroy();

  return response.success({ message: "Product deleted" });
};
```

`destroy()` uses the model's default delete strategy (soft-delete if the model has a `deletedAt` column, hard-delete otherwise). Pass `{ strategy: "permanent" }` to force a hard delete.

## Step 6 — Register the routes

Open `routes.ts` and wire the RESTful chain:

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

`router.route(path)` returns a chainable builder with five named slots — `list`, `show`, `create`, `update`, `destroy`. Each registers the conventional REST verb:

| Slot      | Verb     | Path             |
| --------- | -------- | ---------------- |
| `list`    | `GET`    | `/products`      |
| `show`    | `GET`    | `/products/:id`  |
| `create`  | `POST`   | `/products`      |
| `update`  | `PUT`    | `/products/:id`  |
| `destroy` | `DELETE` | `/products/:id`  |

`.update()` registers `PUT /products/:id` — a full replacement of the resource. If you want a partial update, the builder also exposes a separate `.patch()` slot that registers `PATCH /products/:id`; the two are independent and can coexist on the same path.

The `guarded(...)` wrapper is a project-local helper from `src/app/shared/utils/router.ts` — it applies `authMiddleware("user")` to every route inside. Drop it if your routes are public, or use `router.route(...)` directly outside the wrapper.

The dev server picks up the new module on the next save. No restart, no compile step.

## Step 7 — Seed some data

Generators only emit a seed file as part of the full `generate.module` scaffold — building the module piece by piece like this, you add one by hand:

```ts title="src/app/products/seeds/products.seed.ts"
import { seeder } from "@warlock.js/core";
import { Product } from "../models/product";

export default seeder({
  name: "Seed Products",
  once: true,
  enabled: true,
  order: 50,
  run: async () => {
    const products = [
      { name: "Cotton T-Shirt", slug: "cotton-tee", price: 19.99, in_stock: true },
      { name: "Hoodie", slug: "hoodie", price: 49.99, in_stock: true },
      { name: "Cap", slug: "cap", price: 14.99, in_stock: false },
    ];

    for (const data of products) {
      await Product.create(data);
    }

    return { recordsCreated: products.length };
  },
});
```

`once: true` means the seeder skips if it has run before. Run it:

```bash
yarn warlock seed
```

## Step 8 — Hit the endpoints

Routes are guarded, so you need an access token. Grab one with `/auth/login` and use it:

```bash
TOKEN="<your-access-token>"

# List
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/products

# Show
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/products/<id>

# Create
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST \
     -d '{"name":"Mug","slug":"mug","price":9.99,"in_stock":true}' \
     http://localhost:3000/products

# Update
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X PUT \
     -d '{"price":12.99}' \
     http://localhost:3000/products/<id>

# Delete
curl -H "Authorization: Bearer $TOKEN" -X DELETE http://localhost:3000/products/<id>
```

Each response is wrapped by the resource — only the fields you declared in `ProductResource.schema` come back over the wire.

## What the generator gives you vs. the worked example

The full `generate.module products` scaffold generates everything in one shot. That's faster for greenfield work but produces stubs you'd refine anyway. The step-by-step path here is the same code at the end — you choose where to spend time.

A few drift notes worth flagging if you compare the generator output to the canonical `src/app/faqs/` module:

- **`organization_id` and `created_by`/`updated_by` columns.** The faqs module stamps these from `request.user` inside the service. The generator doesn't know about your auth model — add the columns and the stamping yourself.
- **`schema/create-*.schema.ts` vs `schema/update-*.schema.ts`.** Both can derive from the model's schema via `.without(...)` or `.partial()`. The generator emits standalone `v.object({...})` stubs because it can't see your model yet.
- **Module folder is `schema/`, not `validation/`.** Older modules in this codebase use `validation/` — that's historical. New modules use `schema/`, which is what the generator and the `warlock-conventions` skill assume.

## Gotchas

- **Always plural for module, singular for entity.** `generate.module products` then `generate.model products/product`. The generator pluralizes/singularizes for you, but mixing them up creates files in the wrong place.
- **Run migrations after every schema change.** Cascade has runtime schema validation; if you add a column to the model without a migration, inserts will fail at the DB layer.
- **`request.validated()` only works on controllers with `.validation = { schema }`.** Without it, `request.validated()` returns `undefined`. Easy to forget when copy-pasting from another controller.
- **Don't put business logic in `routes.ts`.** Conditional routes break the dev server's HMR diff. If you need feature flags, branch inside the controller.

## See also

- [First route](../getting-started/04-first-route.md) — the minimal walkthrough this recipe expands on
- [Project layout](../getting-started/05-project-layout.md) — the module convention in full
- [Routing](../the-basics/02-routing.md) — `router.route(...)`, prefix groups, middleware groups
- [RESTful routes](../the-basics/restful.md) — the full `.list().show().create().update().destroy()` chain, the `.patch()` slot, and `restfulResource(...)`
- [Controllers](../the-basics/03-controllers.md) — controller signature, validation, response shape
- [Repositories](../the-basics/05-repositories.md) — `filterBy`, `listCached`, custom queries
- [Resources](../the-basics/06-resources.md) — output shaping, computed fields
- [Validation guide](../the-basics/validation.md) — seal schemas, DB-aware rules, custom validators
- ``create-module` skill`
- ``register-route` skill`
- ``create-controller` skill`
- ``use-repository` skill`
- ``define-resource` skill`
- ``build-restful` skill`
