---
name: use-repository
description: 'Subclass `RepositoryManager` for data access — declare `source`, `filterBy`, `defaultOptions`, then call `list()`/`listCached()`/`find()`/`create()`/`update()`/`delete()` (and the active/cached/cursor variants). Triggers: `RepositoryManager`, `FilterRules`, `RepositoryOptions`, `.list`, `.listCached`, `.find`, `.findCached`, `.create`, `.update`, `.delete`, `simpleSelectColumns`; "create a repository", "filter rules for a list endpoint", "cursor vs page pagination", "cached vs uncached read"; typical import `import { RepositoryManager } from "@warlock.js/core"`. Skip: cache singleton — `@warlock.js/cache/cache-basics/SKILL.md`; use-case pipelines — `@warlock.js/core/write-use-case/SKILL.md`; wire mapping — `@warlock.js/core/define-resource/SKILL.md`; competing libs `typeorm` Repository, `prisma.client.<model>`, `@nestjs/typeorm`.'
---

# Warlock — use a repository

A repository is a thin wrapper around a Cascade model that centralizes filtering, pagination, and caching. You subclass `RepositoryManager<TModel, TFilter>`, declare `source`/`filterBy`/`defaultOptions`, export a singleton, and call its methods from services. Controllers never touch repositories directly.

## The shape

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

class FaqsRepository extends RepositoryManager<Faq, FaqListOptions> {
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
    orderBy: { id: "desc" },
  };
}

export const faqsRepository = new FaqsRepository();
```

Five lines do the heavy lifting:

1. **`source = Faq`** — Cascade model the repo wraps; auto-instantiates a `CascadeAdapter`.
2. **`simpleSelectColumns`** — projection used when callers pass `simpleSelect: true`.
3. **`filterBy`** — filter-key → operator map; powers the auto-applied WHERE clauses.
4. **`defaultOptions`** — applied to every call (`orderBy`, default `limit`, etc.).
5. **`new FaqsRepository()`** singleton — import this everywhere; never instantiate again.

The class is intentionally private — only the singleton escapes the module. Scaffold with `yarn warlock generate.repository <module>/<entity>`.

## The `filterBy` rules

A `FilterRules` map. Keys are filter input names; values are operators or `[operator, column]` tuples (when the input name differs from the column):

```ts
public filterBy: FilterRules = {
  // input "id" → WHERE id = ?
  id: "=",

  // input "ids" → WHERE id IN (?)
  ids: ["in", "id"],

  // input "name" → WHERE name LIKE %?%
  name: "like",

  // input "price_min" → WHERE price >= ?
  price_min: ["int>=", "price"],

  // input "createdBetween" → WHERE created_at BETWEEN ? AND ?
  createdBetween: ["dateBetween", "created_at"],

  // custom — full control
  search: (value, query, ctx) => {
    query.where((qb) => {
      qb.where("name", "like", value).orWhere("description", "like", value);
    });
  },
};
```

Operators (from `@warlock.js/core/src/repositories/contracts/types.ts`, `FilterOperator`):

- SQL-style: `=`, `!=`, `<>`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`, `between`, `not between`
- Typed coercion: `int`, `int>`, `int>=`, `int<`, `int<=`, `inInt`, `!int`, `integer`, `float`, `double`, `inFloat`, `number`, `inNumber`, `bool`, `boolean`, `null`, `notNull`, `!null`
- Dates: `date`, `date>`, `date>=`, `date<`, `date<=`, `dateBetween`, `inDate`, `dateTime`, `dateTime>`, `dateTime>=`, `dateTime<`, `dateTime<=`, `dateTimeBetween`, `inDateTime`
- Special: `location`, `scope`, `with`, `joinWith`, `similarTo`

For custom logic, pass a function: `(value, query, context) => void` — mutate `query` directly with the query-builder API.

## Method surface

From `@warlock.js/core/src/repositories/repository.manager.ts`. Every method has an `…Active` counterpart that adds the active-record filter (`isActive = true`), and most have a `…Cached` counterpart that reads/writes through the cache layer.

### Finding

```ts
await repo.find(id);                       // by primary key (or model instance)
await repo.findBy(column, value);
await repo.first(options?);                // first matching `options`
await repo.firstId(options?);              // → id only
await repo.exists(options?);               // → boolean
await repo.idExists(id);                   // → boolean
await repo.last(options?);                 // orderBy id desc

await repo.findCached(id);                 // alias of getCached
await repo.getCached(id);
await repo.getCachedBy(column, value);
await repo.firstCached(options?);

await repo.findActive(id);
await repo.firstActive(options?);
await repo.firstActiveCached(options?);
```

### Listing

```ts
// Page-based (default)
const { data, pagination } = await repo.list({ page: 2, limit: 10, status: "active" });

// Cursor-based
const { data, pagination } = await repo.list({
  paginationMode: "cursor",
  limit: 20,
  cursor: lastSeenId,
  direction: "next",
});

await repo.all(options?);                  // unpaginated array
await repo.listActive(options?);
await repo.listCached(options?);           // page-based + cache
await repo.allCached(options?);
await repo.latest(options?);               // orderBy id desc + paginate
await repo.oldest(options?);
```

### Pagination shape

```ts
// page-based — repo.list({ page, limit })
type PaginationResult<T> = {
  data: T[];
  pagination: {
    limit: number;
    result: number; // count in this page
    page: number; // 1-indexed
    total: number; // total rows
    pages: number; // total pages
  };
};

// cursor-based — repo.list({ paginationMode: "cursor", cursor, limit })
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

### CRUD

```ts
await repo.create(data); // → created model
await repo.update(id, data); // → updated model
await repo.delete(id); // → void

await repo.updateMany(filter, data); // → number affected
await repo.deleteMany(filter); // → number affected

await repo.findOrCreate(where, data);
await repo.updateOrCreate(where, data);
```

### Counting

```ts
await repo.count(options?);                // → number
await repo.countActive(options?);
await repo.countCached(options?);
```

### Chunking

```ts
await repo.chunk(500, async (rows, index) => {
  // process 500 at a time; return false to stop early
});

await repo.chunkActive(500, async (rows, index) => {});
```

### Cache control

```ts
await repo.clearCache(); // wipe all repo cache
await repo.clearCache({ id: 5 });
await repo.clearModelCache(model);
await repo.cacheModel(model); // manual cache write
```

## Cached vs uncached

`listCached` / `firstCached` / `getCached` etc. hit the cache layer (`@warlock.js/cache`) first; on miss, they execute and cache. Cache invalidation is automatic on `create`/`update`/`delete` events that the adapter listens to.

Use cached methods by default. Drop to uncached when:

- The data changes too fast for the cache TTL to be useful.
- You need transactional consistency with a write you just made (cache invalidation runs after the event fires; a read in the same tick may still hit stale).
- Diagnosing a cache-related bug.

```ts
// Default — go through cache
await faqsRepository.listCached({ organization_id, status: "published" });

// Diagnostic / write-then-read flow — bypass cache
await faqsRepository.list({ organization_id, status: "published" });
```

## Calling from a service

```ts title="src/app/faqs/services/list-faqs.service.ts"
import { faqsRepository, type FaqListOptions } from "../repositories/faqs.repository";

export async function listFaqsService(filters: FaqListOptions) {
  return faqsRepository.listCached(filters);
}
```

```ts title="src/app/faqs/controllers/list-faqs.controller.ts"
import type { RequestHandler, Response } from "@warlock.js/core";
import { listFaqsService } from "../services/list-faqs.service";

export const listFaqsController: RequestHandler = async (request, response: Response) => {
  const { data, pagination } = await listFaqsService({
    ...request.all(),
    organization_id: request.user.organizationId,
  });

  return response.success({ data, pagination });
};
```

## When to drop to `Model.query()`

Repositories are for the 90% case: filter, paginate, cache. For anything beyond — joins, aggregates, raw expressions, complex `OR` trees — drop to the model's query builder inside a service:

```ts title="src/app/orders/services/order-stats.service.ts"
import { Order } from "../models/order";

export async function orderStatsByMonth(organizationId: string) {
  return Order.query()
    .where("organization_id", organizationId)
    .groupBy(Order.query().raw("DATE_TRUNC('month', created_at)"))
    .select([
      Order.query().raw("DATE_TRUNC('month', created_at) as month"),
      Order.query().raw("COUNT(*) as count"),
      Order.query().raw("SUM(total) as revenue"),
    ])
    .get();
}
```

A repository method exposing `query()` is also fine for service-level shaping:

```ts
class OrdersRepository extends RepositoryManager<Order> {
  public source = Order;

  public async paidLastWeek(organizationId: string) {
    return this.newQuery()
      .where({ organization_id: organizationId, status: "paid" })
      .where("created_at", ">", new Date(Date.now() - 7 * 86_400_000))
      .get();
  }
}
```

`this.newQuery()` returns a fresh `QueryBuilderContract` for the underlying source — no cache, no filter rules, just SQL.

## Repository lifecycle hooks

Override in the subclass for cross-cutting behavior:

```ts
class ProductsRepository extends RepositoryManager<Product> {
  public source = Product;

  protected async onCreate(product: Product, data: any) {
    await searchIndex.add(product);
  }

  protected async onUpdate(product: Product, data: any) {
    await searchIndex.update(product);
  }

  protected async onDelete(id: string | number) {
    await searchIndex.remove(id);
  }
}
```

Available hooks: `beforeListing`, `onList`, `onCreating`, `onCreate`, `onUpdating`, `onUpdate`, `onSaving`, `onSave`, `onDeleting`, `onDelete`. They run inside the repository's adapter — no need to wire events manually.

## Common patterns

### Typed list filter

The second generic on `RepositoryManager` makes `options.<filter>` autocomplete from the caller side:

```ts
type ProductListFilter = {
  category_id?: string;
  price_min?: number;
  price_max?: number;
  in_stock?: boolean;
};

export type ProductListOptions = RepositoryOptions & ProductListFilter;

class ProductsRepository extends RepositoryManager<Product, ProductListOptions> {
  public source = Product;

  public filterBy: FilterRules = {
    category_id: "=",
    price_min: ["int>=", "price"],
    price_max: ["int<=", "price"],
    in_stock: ["bool", "is_in_stock"],
  };
}

// Caller side — typed
await productsRepository.list({ category_id, price_min: 10, in_stock: true });
```

### `simpleSelect` for lightweight payloads

```ts
class UsersRepository extends RepositoryManager<User> {
  public source = User;
  public simpleSelectColumns = ["id", "name", "email"];
}

await usersRepository.list({ simpleSelect: true });
// only id, name, email selected
```

### Custom filter function

```ts
public filterBy: FilterRules = {
  search: (value, query) => {
    query.where((qb) => {
      qb.where("name", "like", `%${value}%`)
        .orWhere("description", "like", `%${value}%`)
        .orWhere("sku", "=", value);
    });
  },
};
```

The third arg is a context object — `{ allValues, dateFormat, ... }` — for filters that compose with other inputs.

## Gotchas

- **One singleton per repository.** Module-export `new FaqsRepository()` at the bottom; everyone imports that. Event listeners are wired on construction — instantiating twice double-registers them.
- **Don't access protected members from outside.** `defaultOptions`, `filterBy`, `cacheDriver`, `name` are `protected` for a reason. Configure via subclass; never reach in.
- **`cursor` pagination owns its sort key.** If you pass `paginationMode: "cursor"` _and_ an `orderBy: { id: "asc" }` that conflicts with the cursor column, the framework warns and ignores your `orderBy`. Use cursor pagination's `direction` and `cursorColumn` options instead.
- **`listCached` only supports page-based pagination.** Cursor mode bypasses the cache.
- **`findCached` is an alias of `getCached`.** Both look up by `id` through the cache. There is no `findCachedBy` — use `getCachedBy(column, value)`.
- **`create`/`update`/`delete` clear cache on every write.** That's why `listCached` is usually safe. If you write outside the repository (raw query, bulk insert), the cache won't invalidate — call `repo.clearCache()` manually.
- **The repository owns `clearCache` per repo + per model.** It doesn't reach into other repositories. If a write in one module affects another's cache, invalidate explicitly from a service.
- **Adapter init is `setTimeout(0)` delayed.** Don't call repository methods synchronously inside the constructor — they'll fire before the adapter is ready.

## See also

- [`create-module/SKILL.md`](../create-module/SKILL.md) — `warlock generate.repository` and where the file lives.
- [`@warlock.js/cache/cache-basics/SKILL.md`](../../../cache/skills/cache-basics/SKILL.md) — the cache singleton behind `listCached` / `getCached`. See sibling skills (`pick-cache-driver`, `use-swr`) for related tasks.
- [`write-use-case/SKILL.md`](../write-use-case/SKILL.md) — calling repositories from a use-case handler.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — mapping repository output to the wire format.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — services that consume repositories from the controller edge.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — controller → service → repository → model layering.
