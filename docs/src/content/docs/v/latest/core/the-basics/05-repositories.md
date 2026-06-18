---
title: "Repositories"
description: The data-access layer — RepositoryManager subclasses with filter rules, default options, pagination, and built-in caching. The shape every Warlock module's data layer takes.
sidebar:
  order: 10
  label: "Repositories"
---

A repository in Warlock is a small class that sits between your services and your model. It owns filtering, pagination, and caching — the dull mechanics that every CRUD list endpoint needs and that should not have to be reinvented per call site.

The reason repositories exist as a primitive: every data layer in every app does the same five things — list with filters, find by id, create, update, delete. If you write all five in your service file, you end up with one filter system per service. If you write them in your model, you tangle output shape with data access. The repository is the shared home that gives every module the same surface and the same caching story.

This page covers the shape, the filter system, the cached variants, and how to call it from a service. Cursor pagination, custom adapters (Prisma, raw SQL), and the cache-invalidation story live in [Repositories — deep dive](./repositories-deep.md).

## The shape

```ts title="src/app/products/repositories/products.repository.ts"
import type { FilterRules, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { Product } from "../models/product";

type ProductListFilter = {
  ids?: string[];
  category_id?: string;
  status?: string;
  search?: string;
};

export type ProductListOptions = RepositoryOptions & ProductListFilter;

class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  public simpleSelectColumns: string[] = ["id", "name", "price"];

  public filterBy: FilterRules = {
    id: "=",
    ids: ["in", "id"],
    category_id: "=",
    status: "=",
    search: ["like", ["name", "description"]],
  };

  public defaultOptions: RepositoryOptions = {
    orderBy: { id: "desc" },
  };
}

export const productsRepository = new ProductsRepository();
```

The second generic argument is the **filter shape** (`ProductListFilter`), not the merged options type — it's what gives `repo.list({...})` autocomplete on your filter keys. The framework merges it with `RepositoryOptions` internally.

Four properties on the class:

- **`source`** — the model class. The framework infers the adapter from the source type.
- **`simpleSelectColumns`** — the column subset used when callers pass `simpleSelect: true` (lightweight lists).
- **`filterBy`** — the filter rules; maps incoming filter keys to query operations.
- **`defaultOptions`** — applied to every query unless the caller overrides.

The bottom line exports a singleton — every service in the module imports the same instance.

## Where it lives

One file per repository under the module's `repositories/` folder, named `<entity>s.repository.ts` (plural):

```
src/app/products/repositories/
  products.repository.ts
```

The exported instance is camelCase + `Repository` suffix: `productsRepository`, `faqsRepository`, `usersRepository`.

## The everyday methods

These are the methods you'll reach for daily. Every repository inherits them from `RepositoryManager`:

| Method                                | What it returns                              | Use when                                |
| ------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `list(options?)`                      | `{ data, pagination }`                       | paginated read                          |
| `listCached(options?)`                | `{ data, pagination }` (cached)              | list endpoints with stable filters      |
| `all(options?)`                       | `T[]`                                        | non-paginated read (be careful)         |
| `find(id)`                            | `T \| null`                                  | by primary key                          |
| `findBy(column, value)`               | `T \| null`                                  | by any column                           |
| `first(options?)`                     | `T \| null`                                  | first match for options                 |
| `getCached(id)`                       | `T \| null` (cached)                         | by primary key, cached                  |
| `create(data)`                        | `T`                                          | insert                                  |
| `update(id, data)`                    | `T`                                          | update by id                            |
| `delete(id)`                          | `void`                                       | delete by id                            |
| `count(options?)`                     | `number`                                     | total matching records                  |
| `exists(filter?)`                     | `boolean`                                    | existence check                         |
| `findOrCreate(where, data)`           | `T`                                          | upsert-by-where (insert if missing)     |
| `updateOrCreate(where, data)`         | `T`                                          | true upsert                             |

There's also `chunk(size, callback)` for processing large datasets without loading everything into memory, and `listActive/findActive/...` variants that auto-add an `isActive` filter — see [Repositories — deep dive](./repositories-deep.md).

## The pagination shape

`list(...)` always returns the same envelope:

```ts
{
  data: T[],
  pagination: {
    limit: number,
    result: number,    // count in current page
    page: number,
    total: number,     // total across all pages
    pages: number,     // total page count
  }
}
```

The controller passes this straight through:

```ts
const { data: products, pagination } = await productsRepository.list({
  page: 2,
  limit: 20,
  category_id: "shoes",
});

return response.success({ products, pagination });
```

Twenty rows + the pagination metadata in one round-trip. The framework knows what `page` and `limit` mean; you don't write the LIMIT/OFFSET SQL.

## The filter system

`filterBy` is the heart of the repository. Each rule maps a key in the caller's options to a query operation:

```ts
public filterBy: FilterRules = {
  id: "=",                               // exact match
  ids: ["in", "id"],                     // WHERE id IN (...)
  category_id: "=",
  status: "=",
  search: ["like", ["name", "description"]],  // LIKE across two columns
};
```

Three forms:

| Form                            | Behaviour                                                       |
| ------------------------------- | --------------------------------------------------------------- |
| `"="` / `">"` / `"!="`          | direct comparison on the same-named column                      |
| `["op", "column"]`              | comparison on a different column (rename incoming → DB column)  |
| `["op", ["col1", "col2"]]`      | apply the comparison across multiple columns (OR'd)             |

The full operator set includes `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`, `between`, plus type-coercing operators (`int`, `bool`, `date`, `dateTime`, `dateBetween`, `inDate`, …) and relation operators (`with`, `joinWith`, `scope`).

You can also pass a function for fully custom logic:

```ts
public filterBy: FilterRules = {
  near: (value, query) => {
    query.whereRaw("ST_Distance(location, ?) < ?", [value.point, value.radius]);
  },
};
```

The full operator reference is in [Repositories — deep dive](./repositories-deep.md).

## Default options

`defaultOptions` is what the framework applies if the caller didn't override:

```ts
public defaultOptions: RepositoryOptions = {
  orderBy: { id: "desc" },
  defaultLimit: 25,
};
```

Caller options always win — pass `{ orderBy: ["name", "asc"] }` and it overrides the default. The default is what you want 90% of the time so the boring cases stay one-line.

## Cached reads

`listCached(...)` and `getCached(...)` are the cached siblings. Same signature, same return shape — but they check the cache first, populate on miss, and serve subsequent reads from memory until the cache is invalidated:

```ts
const { data, pagination } = await productsRepository.listCached({
  category_id: "shoes",
  page: 1,
  limit: 20,
});
```

The cache key includes the options, so different filter combinations get different cache entries. The framework also wires automatic invalidation: when the model emits `created`, `updated`, or `deleted`, the repository's cache is cleared.

For reads with high traffic and low write churn (product catalog, taxonomy, lookup tables), `listCached` is a one-character win over `list`.

## CRUD writes

`create`, `update`, `delete` proxy to the underlying model (via the Cascade adapter):

```ts
const product = await productsRepository.create({
  name: "T-shirt",
  price: 29.99,
  category_id: "apparel",
});

await productsRepository.update(product.id, { price: 24.99 });

await productsRepository.delete(product.id);
```

These also fire the model's lifecycle events (`creating` → `created`, `updating` → `updated`, `deleting` → `deleted`), which is how the cache invalidation hook above stays in sync. See **[Events and hooks](/v/latest/cascade/architecture-concepts/events-and-hooks/)** in the Cascade docs for the full event surface.

You can also `create()` directly on the model — `Product.create(...)` — when you're inside a service and don't need the repository's filter machinery. Both paths fire the same events; pick whichever reads cleaner.

## A real example end-to-end

The actual `faqs` repository from the reference codebase — thirty-five lines, complete:

```ts title="src/app/faqs/repositories/faqs.repository.ts"
import type { FilterRules, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { Faq } from "../models/faq";

type FaqListFilter = {
  ids?: string[];
  id?: string;
  organization_id?: string;
  project_id?: string;
  status?: string;
};

export type FaqListOptions = RepositoryOptions & FaqListFilter;

class FaqsRepository extends RepositoryManager<Faq, FaqListFilter> {
  public source = Faq;

  public simpleSelectColumns: string[] = ["id"];

  public filterBy: FilterRules = {
    id: "=",
    ids: ["in", "id"],
    organization_id: "=",
    project_id: "=",
    status: "=",
  };

  public defaultOptions: RepositoryOptions = {
    orderBy: {
      id: "desc",
    },
  };
}

export const faqsRepository = new FaqsRepository();
```

The service that calls it is one line:

```ts title="src/app/faqs/services/list-faqs.service.ts"
import { faqsRepository, type FaqListOptions } from "../repositories/faqs.repository";

export async function listFaqsService(filters: FaqListOptions) {
  return faqsRepository.listCached(filters);
}
```

And the controller's two lines:

```ts title="src/app/faqs/controllers/list-faqs.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { listFaqsService } from "../services/list-faqs.service";

export const listFaqsController: RequestHandler = async (request, response) => {
  const { data: faqs, pagination } = await listFaqsService({
    ...request.all(),
    organization_id: request.user.organizationId,
  });

  return response.success({ faqs, pagination });
};
```

Three files, ~50 lines, full CRUD list with filtering, pagination, and caching. The repository carries all the mechanics; the controller is thin; the service is a one-line pass-through that exists so the controller doesn't directly import the repository.

## Reading by id, with a not-found

A common pattern: fetch by id, throw if missing, let the framework's catch-all map to a 404.

```ts title="src/app/faqs/services/get-faq.service.ts"
import { ResourceNotFoundError } from "@warlock.js/core";
import { faqsRepository } from "../repositories/faqs.repository";

export async function getFaqService(id: number | string) {
  const faq = await faqsRepository.getCached(id);

  if (!faq) {
    throw new ResourceNotFoundError("Faq resource not found!");
  }

  return faq;
}
```

`ResourceNotFoundError` extends `HttpError` (status 404) — the framework maps it to a 404 response automatically. The controller doesn't need a branching `if (!faq) return response.notFound(...)` — it just calls `getFaqService(id)` and trusts the throw.

## Running code around writes

The base class defines a set of protected hook methods (`onCreating`, `onCreate`, `onUpdating`, `onUpdate`, `onSaving`, `onSave`, `onDeleting`, `onDelete`, `beforeListing`, `onList`), but **they are not currently wired** — `create()`, `update()`, `delete()`, and `list()` never call them, so overriding them does nothing today. Don't build on them.

To run side effects around a write, use one of these two paths instead:

**Cascade model events** — fire on every write (repository or direct `Product.create(...)`), and are exactly what the repository's cache invalidation already listens to:

```ts title="src/app/products/models/product.ts"
import { Model } from "@warlock.js/cascade";

export class Product extends Model {
  public static collection = "products";

  protected async onCreating() {
    this.set("slug", slugify(this.get("name")));
  }

  protected async onCreated() {
    await searchIndex.add(this);
  }
}
```

**Override the action method** — when the behaviour belongs at the repository layer, override `create()` / `update()` / `delete()` and call `super`:

```ts
class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  public async create(data: any) {
    const product = await super.create(data);
    await searchIndex.add(product);
    return product;
  }
}
```

For the full model event surface, see **[Events and hooks](/v/latest/cascade/architecture-concepts/events-and-hooks/)** in the Cascade docs.

## Gotchas

- **`list()` returns `{ data, pagination }`, not just an array.** Always destructure. If you find yourself writing `result.data.map(...)`, that's expected — the wrapper is the contract.
- **`listCached` caches per filter combination.** Two requests with different filters hit two different cache entries. Model writes invalidate all entries for that repository.
- **`simpleSelect: true` is opt-in.** Callers ask for it; the framework doesn't apply it by default. Use it on heavy list views where you only need a few columns.
- **`defaultLimit` defaults to 15** at the framework level. Set `defaultLimit` in `defaultOptions` to override per repository.
- **Filter rules are not optional.** If a caller passes `{ status: "active" }` and there's no `status` key in `filterBy`, the filter is silently dropped — the query is unfiltered. Always wire every filter key you accept.

## See also

- **[Resources](./06-resources.md)** — shaping the repository's output for the wire.
- **[Repositories — deep dive](./repositories-deep.md)** — cursor pagination, custom adapters, `chunk()`, the full filter operator reference, custom cache drivers.
- **[Cache](../digging-deeper/cache.md)** — the cache layer the repository sits on top of.
- **[Events and hooks](/v/latest/cascade/architecture-concepts/events-and-hooks/)** — Cascade model lifecycle events the repository's cache invalidation hooks into.
- **[Cached list recipe](../recipes/cached-list.md)** — full cached list endpoint, end to end.

## Next

Continue to **[Resources](./06-resources.md)** to see how the model becomes the wire response.
