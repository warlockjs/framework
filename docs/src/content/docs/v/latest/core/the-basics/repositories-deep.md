---
title: "Repositories deep dive"
description: Everything on RepositoryManager — every method, every filter operator, cursor pagination, custom queries, the caching story, and the active-record convenience surface.
sidebar:
  order: 11
  label: "Repositories deep dive"
---

The [essentials page on repositories](./05-repositories.md) introduces the shape and the everyday methods. This page covers the rest — every method on `RepositoryManager`, every filter operator, both pagination modes, custom queries past the filter system, the cache layer underneath, and the `*Active` convenience tier.

Reach for this page when "list and find" stops being enough — when you need cursor pagination on a million-row table, a `near(latitude, longitude)` filter, an extra clause the filter system can't express, or you're swapping the cache driver per repository.

## The class shape

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

Two type parameters on the generic: `T` (the model) and `F` (the filter shape). `F` is what gives `repo.list({...})` autocomplete on filter keys.

Every property below is optional except `source`.

| Property              | Type                          | What it does                                                            |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `source`              | model class                   | Used by the default adapter resolver. The framework reads it to know what model to query. |
| `filterBy`            | `FilterRules`                 | Maps filter keys to query operations. The heart of the repository.       |
| `defaultOptions`      | `Partial<RepositoryOptions>`  | Applied to every list/all query unless the caller overrides.            |
| `simpleSelectColumns` | `string[]`                    | Column subset returned when callers pass `simpleSelect: true`.          |
| `isActiveColumn`      | `string` (default `"isActive"`) | The column the `*Active` variants filter on.                            |
| `isActiveValue`       | `any` (default `true`)        | The value `isActiveColumn` must match for `*Active` queries.            |
| `name`                | `string`                      | Used as a prefix in cache keys. Auto-resolved from the model's table.   |
| `isCacheable`         | `boolean` (default `true`)    | Master switch for caching on this repository.                           |
| `cacheDriver`         | `CacheDriver`                 | Per-repository cache driver. Falls back to the app's default.           |

The exported instance is the singleton — every service in the module imports the same instance.

## The everyday methods, in full

These are inherited from `RepositoryManager`. The page in essentials shows the shortest list; this one covers them all.

### Read — by id

| Method                  | Returns               | Notes                                                |
| ----------------------- | --------------------- | ---------------------------------------------------- |
| `find(id)`              | `T \| null`           | By primary key.                                      |
| `findBy(column, value)` | `T \| null`           | By any column.                                       |
| `findActive(id)`        | `T \| null`           | By id, filtered by `isActiveColumn`.                 |
| `findByActive(col, v)`  | `T \| null`           | By column, filtered by `isActiveColumn`.             |
| `idExists(id)`          | `boolean`             | Exists-by-id shortcut.                               |
| `idExistsActive(id)`    | `boolean`             | Same, active only.                                   |

### Read — first / last by filter

| Method                       | Returns              | Notes                                                            |
| ---------------------------- | -------------------- | ---------------------------------------------------------------- |
| `first(options?)`            | `T \| null`          | First match for the filter.                                      |
| `firstActive(options?)`      | `T \| null`          | First match, active only.                                        |
| `last(options?)`             | `T \| null`          | Last match (orderBy `id desc` by default).                       |
| `lastActive(options?)`       | `T \| null`          | Same, active only.                                               |
| `firstId(options?)`          | `string \| number`   | `first()` then `.id`.                                            |
| `firstUuid(options?)`        | `string`             | `first()` then `.uuid`.                                          |
| `firstActiveId(options?)`    | `string \| number`   | First active, just the id.                                       |
| `firstActiveUuid(options?)`  | `string`             | First active, just the uuid.                                     |
| `exists(filter?)`            | `boolean`            | Existence check by filter.                                       |
| `existsActive(filter?)`      | `boolean`            | Same, active only.                                               |

### Read — listing

The headline pair plus their variants:

| Method                       | Returns                                            | Notes                                  |
| ---------------------------- | -------------------------------------------------- | -------------------------------------- |
| `list(options?)`             | `{ data, pagination }` (pages or cursor)           | The default list.                      |
| `listActive(options?)`       | same                                               | List, active only.                     |
| `all(options?)`              | `T[]`                                              | Non-paginated. Be careful on big sets. |
| `allActive(options?)`        | `T[]`                                              | Same, active only.                     |
| `latest(options?)`           | `{ data, pagination }`                             | `orderBy: ["id", "desc"]`.             |
| `latestActive(options?)`     | same                                               | Latest, active only.                   |
| `oldest(options?)`           | same                                               | `orderBy: ["id", "asc"]`.              |
| `oldestActive(options?)`     | same                                               | Oldest, active only.                   |

### Read — counts

| Method                       | Returns                                            | Notes                                  |
| ---------------------------- | -------------------------------------------------- | -------------------------------------- |
| `count(options?)`            | `number`                                           | Count by filter.                       |
| `countActive(options?)`      | `number`                                           | Count, active only.                    |
| `countCached(options?)`      | `number`                                           | Cached count.                          |
| `countActiveCached(options?)` | `number`                                          | Cached count, active only.             |

### Write

| Method                            | Returns | Notes                                                              |
| --------------------------------- | ------- | ------------------------------------------------------------------ |
| `create(data)`                    | `T`     | Insert. Fires the model's `creating` / `created` events.           |
| `update(id, data)`                | `T`     | Update by id. Fires `updating` / `updated`. Accepts model or id.   |
| `delete(id)`                      | `void`  | Delete by id. Fires `deleting` / `deleted`.                        |
| `updateMany(filter, data)`        | `number` | Bulk update. Returns affected count.                              |
| `deleteMany(filter)`              | `number` | Bulk delete. Returns deleted count.                               |
| `findOrCreate(where, data)`       | `T`     | Find or insert if missing.                                         |
| `updateOrCreate(where, data)`     | `T`     | True upsert.                                                       |

### Bulk read

| Method                                  | Returns | Notes                                                          |
| --------------------------------------- | ------- | -------------------------------------------------------------- |
| `chunk(size, callback, options?)`       | `void`  | Process in chunks. Return `false` from the callback to stop.   |
| `chunkActive(size, callback, options?)` | `void`  | Same, active only.                                             |

A real chunk pattern — for reindexing or batch jobs:

```ts
await productsRepository.chunk(500, async (products, chunkIndex) => {
  console.log(`Processing chunk ${chunkIndex}`);

  for (const product of products) {
    await searchIndex.update(product);
  }
});
```

### Cached read

Every cached variant. The plain `list/find/all/first/last` versions have a `*Cached` sibling — pick the cached one for read-heavy endpoints with stable filters.

| Method                              | Returns                  | Notes                                          |
| ----------------------------------- | ------------------------ | ---------------------------------------------- |
| `findCached(id)` / `getCached(id)`  | `T \| null` (cached)     | The two names are aliases.                     |
| `getCachedBy(column, value)`        | `T \| null` (cached)     | Cached version of `findBy`.                    |
| `getActiveCached(id)`               | `T \| undefined`         | Cached, also checks the active column.         |
| `firstCached(options?)`             | `T \| null` (cached)     | Cached `first()`.                              |
| `firstActiveCached(options?)`       | same                     | First active, cached.                          |
| `lastCached(options?)`              | `T \| null` (cached)     | Cached `last()`.                               |
| `lastActiveCached(options?)`        | same                     | Last active, cached.                           |
| `listCached(options?)`              | `{ data, pagination }`   | Cached page list (page-mode only).             |
| `listActiveCached(options?)`        | same                     | Cached list, active only.                      |
| `allCached(options?)`               | `T[]` (cached)           | Cached non-paginated list.                     |
| `allActiveCached(options?)`         | `T[]` (cached)           | Same, active only.                             |
| `countCached(options?)`             | `number` (cached)        | Cached count.                                  |
| `firstCachedId / firstCachedUuid`   | id-or-uuid               | Cached id/uuid helpers.                        |
| `firstActiveCachedId / Uuid`        | id-or-uuid               | Same, active.                                  |

Cache invalidation is automatic — see the [caching section](#caching) below.

## The `RepositoryOptions` shape

Every list/all/count/first method takes `options`. The shape is shared:

```ts
type RepositoryOptions = {
  paginationMode?: "pages" | "cursor";
  paginate?: boolean;
  page?: number;
  limit?: number;
  defaultLimit?: number;
  select?: string[];
  simpleSelect?: true;
  deselect?: string[];
  orderBy?: "random" | [string, "asc" | "desc"] | { [col]: "asc" | "desc" };
  cursor?: string | number;
  direction?: "next" | "prev";
  cursorColumn?: string;
  perform?: (query, options) => void;
};
```

The interesting ones:

| Field            | Purpose                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `page`           | 1-indexed page number (default `1`).                                           |
| `limit`          | Items per page. Defaults via `defaultLimit` or `15`.                           |
| `defaultLimit`   | Fallback when `limit` isn't set. Per-repository default.                       |
| `select`         | Explicit column allow-list.                                                    |
| `simpleSelect`   | When `true`, use `simpleSelectColumns` from the repository.                    |
| `deselect`       | Explicit deny-list of columns.                                                 |
| `orderBy`        | The only ordering field that's honored. Three forms — see below.              |
| `perform`        | Escape hatch — custom query callback. Covered in [Custom queries](#custom-queries-beyond-filterby). |

> **`sortBy` / `sortDirection` are not honored.** The `RepositoryOptions` type still carries them, but `applyOptionsToQuery` only reads `orderBy` — passing `sortBy`/`sortDirection` does nothing. Use `orderBy` for all ordering. Likewise, there is no working `purgeCache` option: invalidation is driven by model events (see [Caching](#caching)), so a `purgeCache` flag on the options object is inert.

`orderBy` has three forms:

```ts
// 1. Column → direction map
orderBy: { created_at: "desc", id: "asc" }

// 2. Single-column tuple
orderBy: ["created_at", "desc"]

// 3. Random ordering
orderBy: "random"
```

And the typed form — `TypedRepositoryOptions<F>` — is what the public method signatures use. It's `RepositoryOptions & Partial<F>`, where `F` is the filter shape you pass as the second generic. This is what makes `repo.list({ organization_id: "..." })` autocomplete-safe.

## The pagination shape — page-based

The default. Returns `{ data, pagination: { limit, result, page, total, pages } }`:

```ts
const { data: products, pagination } = await productsRepository.list({
  page: 2,
  limit: 20,
  category_id: "shoes",
});

// pagination:
// {
//   limit: 20,
//   result: 20,   // items in this page
//   page: 2,
//   total: 84,    // total across all pages
//   pages: 5,
// }
```

The full type:

```ts
type PaginationResult<T> = {
  data: T[];
  pagination: {
    limit: number;
    result: number;
    page: number;
    total: number;
    pages: number;
  };
};
```

This is the default for `list()`, `listActive()`, `listCached()`, `latest()`, `oldest()`.

## The pagination shape — cursor-based

For tables where counting `total` would be expensive (millions of rows) or for "load more" infinite scroll UIs, switch to cursor mode by passing `paginationMode: "cursor"`:

```ts
const { data: products, pagination } = await productsRepository.list({
  paginationMode: "cursor",
  limit: 20,
  cursor: lastSeenId,
  direction: "next",
  cursorColumn: "id",
});

// pagination:
// {
//   limit: 20,
//   result: 20,
//   hasMore: true,
//   nextCursor: 1234,
//   prevCursor: 1215,
// }
```

The full type:

```ts
type CursorPaginationResult<T> = {
  data: T[];
  pagination: {
    limit: number;
    result: number;
    hasMore: boolean;
    nextCursor?: string | number;
    prevCursor?: string | number;
  };
};
```

The cursor mode owns the sort order for `cursorColumn` — passing `orderBy` on the same column is silently overridden and warns. Pass `orderBy` for a secondary sort if you want one.

The `list()` method has overloads — when you pass `paginationMode: "cursor"`, TypeScript narrows the return to `CursorPaginationResult<T>`. Without it, you get `PaginationResult<T>`.

The cached `listCached(...)` is **page-mode only**. Cursor pagination skips the cache.

## The filter system, in full

`filterBy` is the heart of the repository. Each rule maps a filter key to a query operation. The full type:

```ts
type FilterRule =
  | FilterOperator                       // "="   →  WHERE key = value
  | FilterFunction                       // (value, query, ctx) => void
  | [FilterOperator]                     // ["="]  →  same as "="
  | [FilterOperator, string]             // ["in", "id"]  →  rename
  | [FilterOperator, string[]];          // ["like", ["name", "description"]]  →  OR across columns
```

### The four shapes

```ts
public filterBy: FilterRules = {
  // 1. Plain operator — column name matches the key
  id: "=",

  // 2. Operator + rename — incoming "ids" applies to column "id"
  ids: ["in", "id"],

  // 3. Operator + multi-column — OR across columns
  search: ["like", ["name", "description"]],

  // 4. Custom function — fully bespoke logic
  near: (value, query) => {
    query.whereRaw("ST_Distance(location, ?) < ?", [value.point, value.radius]);
  },
};
```

### The full operator set

Every operator the Cascade adapter supports. Anything else falls through to `WhereOperator` (the SQL operators), which you can also use directly.

#### SQL where operators

| Operator       | What it does                            | Filter input                              |
| -------------- | --------------------------------------- | ----------------------------------------- |
| `"="`          | `WHERE col = value`                     | scalar                                    |
| `"!="` / `"<>"`| `WHERE col != value`                    | scalar                                    |
| `">"` / `">="` | `WHERE col > value` / `>=`              | scalar                                    |
| `"<"` / `"<="` | `WHERE col < value` / `<=`              | scalar                                    |
| `"like"`       | `WHERE col LIKE value`                  | string with `%` or plain (framework adds) |
| `"not like"`   | `WHERE col NOT LIKE value`              | string                                    |
| `"in"`         | `WHERE col IN (...)`                    | array (single-value auto-wraps)           |
| `"not in"`     | `WHERE col NOT IN (...)`                | array                                     |
| `"between"`    | `WHERE col BETWEEN a AND b`             | `[a, b]`                                  |
| `"not between"`| `WHERE col NOT BETWEEN a AND b`         | `[a, b]`                                  |

#### Type-coercing operators

These coerce the incoming filter value before applying the comparison — useful when the query string came from an HTTP request and everything is a string by default.

| Operator     | Behaviour                                                          |
| ------------ | ------------------------------------------------------------------ |
| `"bool"` / `"boolean"` | Coerce value via truthy rules, then `WHERE col = value`. |
| `"int"` / `"integer"`  | `parseInt(value)`, then `WHERE col = value`.            |
| `"!int"`     | `parseInt(value)`, then `WHERE col != value`.                      |
| `"int>"` / `"int>="` / `"int<"` / `"int<="` | `parseInt`, then `WHERE col <op> value`. |
| `"inInt"`    | `parseInt` on each item, then `WHERE col IN (...)`.                |
| `"number"`   | `Number(value)`, then `WHERE col = value`.                         |
| `"inNumber"` | `Number` on each item, then `WHERE col IN (...)`.                  |
| `"float"` / `"double"` | `parseFloat(value)`, then `WHERE col = value`.           |
| `"inFloat"`  | `parseFloat` per item, then `WHERE col IN (...)`.                  |

#### Null operators

| Operator           | Behaviour                              |
| ------------------ | -------------------------------------- |
| `"null"`           | `WHERE col IS NULL`.                   |
| `"notNull"` / `"!null"` | `WHERE col IS NOT NULL`.          |

#### Date / datetime operators

These respect `dateFormat: "DD-MM-YYYY"` and `dateTimeFormat: "DD-MM-YYYY HH:mm:ss"` (the framework defaults).

| Operator                                | Behaviour                                                       |
| --------------------------------------- | --------------------------------------------------------------- |
| `"date"`                                | Parse value as date, then `WHERE col = date`.                   |
| `"date>"` / `"date>="` / `"date<"` / `"date<="` | Parse + comparison.                                  |
| `"dateBetween"`                         | Value is `[from, to]`. `WHERE col BETWEEN`.                     |
| `"inDate"`                              | Array of dates. `WHERE col IN (...)`.                           |
| `"dateTime"`                            | Same shape as `"date"` but uses `dateTimeFormat`.               |
| `"dateTime>"` / `>=` / `<` / `<=`       | DateTime comparisons.                                            |
| `"dateTimeBetween"`                     | DateTime between.                                                |
| `"inDateTime"`                          | DateTime IN.                                                     |

#### Relation operators

These reach into Cascade's relation system from the filter layer.

| Operator         | Behaviour                                                                  |
| ---------------- | -------------------------------------------------------------------------- |
| `"with"`         | Eager-load the named relation when the filter value is truthy.             |
| `"joinWith"`     | Eager-load via SQL JOIN (forces an INNER JOIN — implicitly filters).       |
| `"scope"`        | Apply a model scope (e.g. `Model.scope("published")`) when value is truthy. |
| `"similarTo"`    | Vector similarity search — `column similarTo embeddingArray`.              |

A real example from the reference codebase — joining contacts onto chat queries:

```ts
public filterBy: FilterRules = {
  organization_id: "=",
  withContact: ["joinWith", "contact"],   // filter input is truthy → JOIN contact
  aiAgent: ["joinWith", "aiAgent"],
  isEscalated: ["bool", "is_escalated"],
  hasNoStaff: (_value, query) => query.whereNull("staff_id"),
};
```

A caller passing `{ withContact: true }` gets the contact relation joined into the query. Passing `{ hasNoStaff: true }` runs the custom function — there's no point where the framework guesses; you said what you wanted.

### Silent drops

**If a caller passes a filter key that isn't in `filterBy`, it's silently dropped.** The query runs unfiltered for that key. This is by design — your repository declares its supported filters and the framework refuses to guess. The flip side: if you want a filter, you must wire it in `filterBy`. Forgetting is the most common repository bug.

A defensive pattern: always declare every filter key your `F` type advertises. TypeScript shows you `F`; `filterBy` must cover it.

## Default options

`defaultOptions` is what the framework applies if the caller didn't override:

```ts
public defaultOptions: RepositoryOptions = {
  orderBy: { id: "desc" },
  defaultLimit: 25,
};
```

Caller options always win. Pass `{ orderBy: ["name", "asc"] }` and it overrides the default. The default is what you want most of the time so the boring cases stay one-line.

A reasonable choice for most catalog-style repositories: `orderBy: { id: "desc" }` and a `defaultLimit` higher or lower than the framework default of 15, depending on the entity.

## Custom queries beyond `filterBy`

Sometimes the filter system isn't enough. Three escape hatches, in order of escalating ceremony:

### 1. `perform` callback

The simplest one — pass a function that mutates the query builder:

```ts
const result = await productsRepository.list({
  category_id: "shoes",
  perform: (query) => {
    query.where("inventory_count", ">", 0);
    query.orderBy("popularity_score", "desc");
  },
});
```

Useful for one-off "this controller needs an extra clause" cases without bloating `filterBy`.

### 2. A custom method on the repository

For reusable cases that don't fit the filter shape:

```ts
class ContactsRepository extends RepositoryManager<Contact, ContactsRepositoryFilter> {
  public source = Contact;

  // ...filterBy / defaultOptions...

  public async findByPhone(organizationId: string, phone: string): Promise<Contact | null> {
    return this.first({ organization_id: organizationId, phone });
  }

  public async findByEmail(organizationId: string, email: string): Promise<Contact | null> {
    return this.first({ organization_id: organizationId, email });
  }
}
```

This is from the reference codebase. The method wraps `first()` with a more meaningful name and a tighter type. Same caching story (none here — these aren't `*Cached`).

### 3. Drop to the query builder directly

When you need joins, raw SQL, complex `WHERE` trees:

```ts
class OrdersRepository extends RepositoryManager<Order, OrderFilter> {
  public source = Order;

  public async listWithCustomerSpend(orgId: string, minSpend: number) {
    const query = this.newQuery();

    query
      .where("organization_id", orgId)
      .joinWith("customer")
      .whereRaw("customer.total_spend >= ?", [minSpend])
      .orderBy("created_at", "desc");

    return query.paginate(1, 50);
  }
}
```

`this.newQuery()` returns a fresh query builder bound to the repository's adapter. The `paginate(...)` call returns the same `PaginationResult<T>` shape, so callers see no difference.

## CRUD writes

The three write methods proxy to the underlying model (via the Cascade adapter):

```ts
const product = await productsRepository.create({
  name: "T-shirt",
  price: 29.99,
  category_id: "apparel",
});

await productsRepository.update(product.id, { price: 24.99 });

await productsRepository.delete(product.id);
```

`update()` also accepts a model instance directly — handy when you already have it loaded:

```ts
const product = await productsRepository.find(id);
if (!product) throw new ResourceNotFoundError("Product");

await productsRepository.update(product, { price: 24.99 });
```

Bulk operations skip the model lifecycle (faster, less safe):

```ts
const archivedCount = await productsRepository.updateMany(
  { status: "draft" },
  { status: "archived" },
);

const purgedCount = await productsRepository.deleteMany({ status: "archived" });
```

All single-record writes fire the Cascade model events (`creating` → `created`, `updating` → `updated`, `deleting` → `deleted`). The repository's cache invalidation hooks into these — every write clears the repository's cache namespace.

You can also `create()` directly on the model (`Product.create(...)`) when you're inside a service that has the model imported. Both paths fire the same events; pick whichever reads cleaner.

## Lifecycle hooks are not currently wired

The repository base class defines a set of protected, no-op hook methods — `beforeListing`, `onList`, `onCreating`, `onCreate`, `onUpdating`, `onUpdate`, `onSaving`, `onSave`, `onDeleting`, `onDelete`. **These are not invoked anywhere.** `create()`, `update()`, `delete()`, and `list()` all call the adapter directly and never reach into these methods. Overriding them in a subclass compiles, but the override never runs.

Treat them as dead surface until a future release wires them in. Do not build behaviour on them today — to run code around a write, reach for one of the two paths that actually fire:

### Use Cascade model events for create/update/delete side effects

Model events fire on every write — whether it came through the repository or a direct `Product.create(...)`. This is also exactly what the repository's cache invalidation listens to. Register `onCreated` / `onUpdated` / `onDeleted` (and the `-ing` pre-save variants) on the model:

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

  protected async onUpdated() {
    await searchIndex.update(this);
  }

  protected async onDeleted() {
    await searchIndex.remove(this.id);
  }
}
```

See [Events and hooks](/v/latest/cascade/architecture-concepts/events-and-hooks/) for the full model event surface (`creating`/`created`, `updating`/`updated`, `saving`/`saved`, `deleting`/`deleted`, `fetching`, and so on).

### Override the repository action method for repository-level interception

When the behaviour genuinely belongs at the repository layer — not the model — override `create()` / `update()` / `delete()` / `list()` directly and call `super`:

```ts title="src/app/products/repositories/products.repository.ts"
class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  public async create(data: any) {
    data.slug = slugify(data.name);

    const product = await super.create(data);

    await searchIndex.add(product);

    return product;
  }
}
```

This is explicit, runs reliably, and reads clearly — there's no hidden hook indirection.

## Caching

`isCacheable` is the master switch. When it's `true` (the default), every `*Cached` method reads from / writes to the configured cache driver.

### Cache keys

Cache keys are namespaced per repository:

```
repositories.<name>.list.<JSON-of-options>
repositories.<name>.id.<id>
repositories.<name>.count.<JSON-of-options>
repositories.<name>.all.<JSON-of-options>
```

`<name>` resolves from `this.name` if set, otherwise from `this.adapter.resolveRepositoryName()` — for Cascade, that's the model's `table`.

### Invalidation

Invalidation is automatic: when the model fires `created`, `updated`, or `deleted`, the repository's `clearCache()` runs, which removes the entire namespace:

```ts
public registerEvents() {
  this.eventsCallbacks.push(
    ...this.adapter.registerEvents((source: any) => {
      this.clearCache();
    }),
  );
}
```

Writes on this repository **or any other code path that fires the model events** trigger invalidation. That's why you should let the repository own writes for cached models — going around via raw queries means stale cache.

For finer control, you can invalidate manually:

```ts
await productsRepository.clearCache();          // wipe the whole namespace
await productsRepository.clearModelCache(prod);  // wipe a single id
```

### Per-repository driver

The cache driver is configurable. The default is the framework's shared `cache` from `@warlock.js/cache`. To use a different driver for one repository — say, a Redis-backed one for hot data and memory for cool — call `setCacheDriver`:

```ts
import { redisCache } from "app/shared/cache/redis";

productsRepository.setCacheDriver(redisCache);
```

Or set it directly on the class:

```ts
class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  protected cacheDriver = redisCache;
}
```

### Turning caching off

Per-repository:

```ts
class ProductsRepository extends RepositoryManager<Product, ProductListFilter> {
  public source = Product;

  protected isCacheable = false;
}
```

Now every `*Cached` method falls through to its uncached sibling — same return shape, no read or write to the cache.

App-wide: set `config.get("repository.isCacheable")` to `false`. The per-repository value still wins.

## Active-record convenience

The `*Active` variants are convenience methods for the common "soft-active" pattern — a row has an `isActive` column, and most queries should filter on it.

By default, `isActiveColumn = "isActive"` and `isActiveValue = true`. Every `*Active` method adds `{ [isActiveColumn]: isActiveValue }` to the filter:

```ts
const products = await productsRepository.listActive({
  category_id: "shoes",
});

// Equivalent to:
const products = await productsRepository.list({
  category_id: "shoes",
  isActive: true,
});
```

You can change the column or value per repository. The chats repository from the reference codebase uses `status = "active"`:

```ts
class ChatRepository extends RepositoryManager<Chat, ChatsFilter> {
  public source = Chat;

  public isActiveColumn = "status";
  public isActiveValue = "active";
}
```

Now `listActive()` filters by `status = "active"` instead of `isActive = true`. Same shape, same convenience.

Every read method has an active sibling — `findActive`, `listActive`, `allActive`, `firstActive`, `lastActive`, `firstActiveCached`, `countActive`, and so on. Pick the active variant when you want the soft-active filter; pick the plain one when you don't.

## App-level config

`config.get("repository")` exposes the defaults for every repository:

```ts title="src/config/repository.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  repository: {
    isCacheable: true,
    cacheDriver: customCache,
    isActiveColumn: "isActive",
    isActiveValue: true,
    adapterResolver: (repo) => new CascadeAdapter(repo.source),
    defaultOptions: {
      defaultLimit: 25,
    },
  },
});
```

The shape:

```ts
type RepositoryConfigurations = {
  cacheDriver?: CacheDriver;
  adapterResolver?: (repo) => RepositoryAdapterContract;
  defaultOptions?: Partial<RepositoryOptions>;
  isActiveColumn?: string;
  isActiveValue?: any;
};
```

`adapterResolver` is how you'd swap to a non-Cascade ORM at runtime — return a different `RepositoryAdapterContract` implementation per repository or globally. Out of the box, the framework ships only the Cascade adapter; building a Prisma or Drizzle adapter means implementing the `RepositoryAdapterContract` interface.

## A real example end-to-end

The `chats` repository from the reference codebase — including custom methods, a `joinWith` relation filter, and a custom function filter:

```ts title="src/app/chats/repositories/chats.repository.ts"
import { type FilterRules, type RepositoryOptions, RepositoryManager } from "@warlock.js/core";
import { Chat } from "../models/chat";
import { ChatHandler, ChatStatus } from "../utils/chat-types";

type ChatsFilter = {
  organization_id?: string;
  unit_id?: string;
  unitId?: string;
  status?: string;
  aiAgent?: true;
  withContact?: true;
  id?: string;
  handler?: string;
  staff_id?: string;
  hasNoStaff?: true;
  isEscalated?: boolean;
};

class ChatRepository extends RepositoryManager<Chat, ChatsFilter> {
  public source = Chat;

  public simpleSelectColumns: string[] = ["id", "status", "started_at"];

  public isActiveColumn = "status";

  public isActiveValue = "active";

  public filterBy: FilterRules = {
    organization_id: "=",
    id: "=",
    unit_id: "=",
    unitId: ["=", "unit_id"],
    status: "=",
    handler: "=",
    staff_id: "=",
    aiAgent: ["joinWith", "aiAgent"],
    withContact: ["joinWith", "contact"],
    isEscalated: ["bool", "is_escalated"],
    hasNoStaff: (_value, query) => query.whereNull("staff_id"),
  };

  public defaultOptions: RepositoryOptions = {
    orderBy: {
      started_at: "desc",
    },
  };

  public async listUnclaimedHandoffs(organizationId: string) {
    return this.list({
      organization_id: organizationId,
      hasNoStaff: true,
      isEscalated: true,
    });
  }

  public async listActiveAIChats(organizationId: string) {
    return this.list({
      organization_id: organizationId,
      status: ChatStatus.ACTIVE,
      handler: ChatHandler.AI,
    });
  }

  public async listActiveStaffChats(organizationId: string, staffId: string) {
    return this.list({
      organization_id: organizationId,
      status: ChatStatus.ACTIVE,
      handler: ChatHandler.STAFF,
      staff_id: staffId,
    });
  }
}

export const chatsRepository = new ChatRepository();
```

What's interesting here:

- **`isActiveColumn` is `"status"` and `isActiveValue` is `"active"`.** The active-record convention is per-repository.
- **`aiAgent` and `withContact` are `joinWith` filters.** When the caller passes `{ aiAgent: true }`, the framework JOINs the `aiAgent` relation onto the query.
- **`hasNoStaff` is a custom function.** It needs `WHERE staff_id IS NULL`, which doesn't fit any operator — the function form is the right tool.
- **Three custom methods** wrap the common cases in named patterns. The service layer calls these instead of remembering the right combination of filter keys.

## Gotchas

- **`list()` returns `{ data, pagination }`, not just an array.** Always destructure.
- **`listCached` caches per filter combination.** Two requests with different filter values hit two different cache entries. Model writes invalidate everything for the repository.
- **`simpleSelect: true` is opt-in.** Callers ask for it. Repositories never apply it by default.
- **`defaultLimit` is 15 at the framework level.** Override in `defaultOptions` to change per repository.
- **Filter rules are not optional.** A caller passing `{ status: "active" }` with no `status` key in `filterBy` gets an unfiltered query and a silent drop. Wire every filter key you accept.
- **The repository lifecycle hooks are not wired.** `onCreating`, `onCreate`, `onUpdating`, `onUpdate`, `onSaving`, `onSave`, `onDeleting`, `onDelete`, `beforeListing`, and `onList` exist on the base class but are never called. Use Cascade model events or override the action method instead.
- **`sortBy` / `sortDirection` / `purgeCache` are ignored.** Only `orderBy` controls ordering, and cache invalidation runs off model events — these option fields are inert.
- **Cursor pagination owns the sort order for its `cursorColumn`.** Passing `orderBy` on the same column is silently overridden with a console warning.
- **`updateMany` / `deleteMany` skip the model lifecycle.** Fast, but no `creating` / `updating` / `deleting` events fire — and therefore no cache invalidation. Call `clearCache()` manually after a bulk write, or accept stale cache until next mutation.
- **Bulk paginate methods (`listCached`) only support page mode.** Cursor pagination skips the cache entirely.
- **The repository singleton pattern is non-negotiable** if you want the cache to be shared. Two `new ProductsRepository()` instances have separate cache misses; export one and import it everywhere.

## See also

- **[Repositories (essentials)](./05-repositories.md)** — the shape, the everyday methods, the four-property class.
- **[Use-cases deep dive](./use-cases-deep.md)** — the layer above the repository.
- **[Resources deep dive](./resources-deep.md)** — shaping the repository's output for the wire.
- **[Cache](../digging-deeper/cache.md)** — the cache layer underneath the cached methods.
- **[Events and hooks](/v/latest/cascade/architecture-concepts/events-and-hooks/)** — Cascade model lifecycle events the repository's invalidation hooks into.
