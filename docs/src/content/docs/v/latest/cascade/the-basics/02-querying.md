---
title: "Querying"
sidebar:
  order: 2
  label: "Querying"
---

So far you've found Ada by ID. Real apps ask harder questions: who's active, who signed up last week, sorted by name, paginated by 20. Cascade's query API runs straight off the model — `User.where(...)`, `User.first(...)`, `User.paginate(...)` — no separate client, no repository layer. This page walks the working vocabulary.

## Prerequisites

- A working model (from [Your first model](../getting-started/05-your-first-model.md))
- A handful of records in your DB. If you only have Ada, run `User.create({...})` a few more times before continuing — the snippets below get more interesting with data to filter.

## Filter — `.where()`

The model **is** the query entry point. The intro page promised it; this section delivers.

### Equality — the shorthand

```ts
const activeUsers = await User.where("status", "active").get();
```

`User.where(field, value)` returns a query builder filtered to that condition. `.get()` runs the query and returns an array of `User` instances. No `.query()` call needed up front — `User.where(...)` is the natural entry point.

### Operators

```ts
const adults     = await User.where("age", ">", 18).get();
const recent     = await User.where("created_at", ">=", lastWeek).get();
const nonAdmins  = await User.where("role", "!=", "admin").get();
```

`User.where(field, operator, value)` is the 3-argument form. The common operators are `=`, `!=`, `<`, `<=`, `>`, `>=`, plus `in`, `notIn`, `like`, `between`, and a few others. Same syntax across MongoDB and Postgres. For the full operator list, see the [Query Builder API reference](../reference/query-builder-api.md).

### Compound conditions

```ts
const activeAdmins = await User
  .where("status", "active")
  .where("role", "admin")
  .get();
```

Chained `.where()` calls combine with `AND`. Each call narrows the result.

### Object form

```ts
const targets = await User.where({ status: "active", role: "admin" }).get();
```

Equivalent to chained equalities. Useful when the filter comes from a dynamic source — a request body, a service argument. **Object form only supports equality** — for operators or OR logic, chain `.where()` calls or use callback form.

### Quick reference

| Shape | Use when |
| ----- | -------- |
| `User.where("k", v)` | Single equality, the everyday case |
| `User.where("k", "<", v)` | Operator-based comparison |
| `User.where("k", v).where(...)` | Multiple AND conditions |
| `User.where({ k: v, ... })` | Dynamic filter from an object |

## Get one record

### By ID — `Model.find(id)`

```ts
const user = await User.find(id);  // User | null
```

You saw this on the first-model page. Returns the instance or `null` if nothing matches.

### First match — `Model.first(filter?)`

```ts
const anyUser    = await User.first();                          // first user, any
const firstAdmin = await User.first({ role: "admin" });         // first admin
const filtered   = await User.where("status", "active").first(); // chain into .first()
```

`.first()` with no args returns the very first record (driver-dependent default order). With a filter object, the first record matching by equality. Chain off `.where()` when you need operators or compound conditions.

:::caution — handle `null`

`.first()` and `.find()` both return `null` when there's no match. Always use `?.` or a guard — TypeScript's `strict` mode will catch you if you don't. Resist `!` on query results — unlike an env-var default that you *know* is set, a missing query result isn't intentional, and slapping `!` papers over a real "what if it isn't there?" question.

:::

## Order and paginate

### Ordering — `.orderBy(field, direction)`

```ts
const newest = await User
  .where("status", "active")
  .orderBy("created_at", "desc")
  .get();
```

`.orderBy(field, "asc" | "desc")` sorts. Default direction is `"asc"`. Chain multiple `.orderBy()` calls for secondary sort fields — first call is primary, second is tiebreaker, and so on.

### Pagination — `.paginate({ page, limit, filter? })`

```ts
const page = await User.paginate({ page: 1, limit: 20 });

page.data;        // User[]
page.pagination;  // { total, page, limit, pages }
```

`paginate` returns a structured result with the records under `data` and metadata under `pagination`. Use the static form for the simple case; chain off `.where(...).paginate(...)` for filtered pagination:

```ts
const activePage = await User
  .where("status", "active")
  .paginate({ page: 2, limit: 20 });
```

For cursor-based pagination on very large datasets, see the [Paginated search recipe](../recipes/paginated-search.md).

## Count and existence

### Counting

```ts
const total       = await User.count();
const activeCount = await User.count({ status: "active" });
const adminCount  = await User.where("role", "admin").count();
```

`Model.count(filter?)` is the static form for the simple case; chain off `.where(...).count()` when you need operators.

### Existence — `.exists()` / `.notExists()`

```ts
const hasAdmin    = await User.where("role", "admin").exists();
const noneBlocked = await User.where("status", "blocked").notExists();
```

`.exists()` returns a boolean and short-circuits on the first matching record. `.notExists()` is its inverse. No hydration, no field reads — cheaper than `count() > 0` when all you want is "does at least one match exist?"

:::caution — don't use `.count() > 0`

When you only need a boolean, reach for `.exists()`. `.count()` walks every matching record by definition; `.exists()` stops at the first one. The difference shows up immediately on tables with more than a few thousand rows.

:::

## Get many — `.all(filter?)`

```ts
const allUsers    = await User.all();
const activeUsers = await User.all({ status: "active" });
```

`Model.all(filter?)` is the shortcut for "fetch all records matching a simple equality filter, or every record if no filter." Equivalent to `User.where(...).get()` for the filter case.

:::caution — `.all()` with no filter loads the entire table

On any table with more than a few hundred rows in production, calling `Model.all()` without a filter (and without pagination) is the kind of mistake that turns up in incident reports. If you want everything for a reason, use [pagination](#pagination--paginate-page-limit-filter) or [chunking](#theres-more) — both designed for it. If you want a filtered subset, pass the filter object: `Model.all({ status: "active" })`.

:::

## A hint about scopes

If you find yourself writing the same `.where("status", "active")` across half a dozen services, you're rediscovering scopes — Cascade's way to name and reuse a filter on the model itself.

Defining (one short snippet on the model class):

```ts
static {
  this.addScope("active", (query) => {
    query.where("status", "active");
  });
}
```

Using:

```ts
const activeUsers = await User.query().scope("active").get();
```

Local scopes are **opt-in** — they only run when you call `.scope("name")`. Global scopes (`addGlobalScope`) run on every query for that model — useful for multi-tenancy or default soft-delete filtering — and can be bypassed per-query when needed. Full mechanics (timing, bypassing, inheritance, parameters) live in the [Scopes guide](../digging-deeper/scopes.md).

## There's more

Cascade's query builder is deep — around 60 methods covering shapes you'll need eventually. A named list so you know what to reach for:

| Reach for | When |
| --------- | ---- |
| `.whereIn(field, values)` / `.whereNotIn(field, values)` | Match against / exclude a list |
| `.whereNull(field)` / `.whereNotNull(field)` | Nullability checks |
| `.whereBetween(field, [a, b])` | Inclusive range |
| `.whereDate(field, value)`, `.whereDateBetween`, `.whereDateBefore`, `.whereDateAfter` | Date helpers |
| `.whereLike(field, pattern)` / `.whereStartsWith` / `.whereEndsWith` | Pattern matching |
| `.whereHas(relation, callback)` | Filter by conditions on a related model |
| `.firstOrFail()` | Throw if no match (when you *know* it should exist) |
| `.sum(field)` / `.avg(field)` / `.min(field)` / `.max(field)` | Aggregates |
| `.distinct(field)` / `.pluck(field)` | Single-field reads (distinct values, flat list) |
| `.chunk(size, callback)` | Stream a large table in batches |
| `.cursorPaginate({ limit, cursor })` | Cursor pagination for large datasets |
| `.similarTo(column, embedding)` | Vector similarity search (Postgres/pgvector) |

Each works the same way: chain off `User.where(...)` or `User.query()`, end with the appropriate terminator. The full surface — including joins, group/having, raw expressions, window functions, and JSON helpers — lives in the [Query Builder API reference](../reference/query-builder-api.md).

## Mapping a model to your public API

You've fetched the record. Now what does it look like when you serialize it for an HTTP response?

`JSON.stringify(user)` calls `model.toJSON()` under the hood. With no configuration, that returns `model.data` — **every column on the record**. That's fine for internal use; for an API response it's almost always wrong. Cascade gives you two ways to shape what goes out.

### The fast escape — `static toJsonColumns`

A column allow-list on the model class:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static toJsonColumns = ["id", "name", "email"];
}

JSON.stringify(user);
// → { id: 1, name: "Ada Lovelace", email: "ada@example.com" }
```

One line on the class. Anything outside the allow-list is dropped from serialization. When the public shape is a strict subset of the columns and you don't need to rename or compute anything, this is the right reach.

### The richer path — `static resource`

When you need to rename fields, compute values, default missing data, or hide nested structures, attach a resource class. The contract is minimal — Cascade just wants something where `new resource(data).toJSON()` returns the shape you want:

```ts
class UserResource {
  constructor(private data: Record<string, unknown>) {}

  toJSON() {
    return {
      id: this.data.id,
      displayName: this.data.name,
      contactEmail: this.data.email,
      avatar: this.data.image ?? null,
    };
  }
}

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static resource = UserResource;
}
```

Plain TypeScript class. No framework dependencies — the resource is whatever code you want to run on the data before it leaves your app. Computed fields, conditional output, formatted dates, all of it just runs in `toJSON()`.

:::caution — Default serialization includes everything

If you haven't set `toJsonColumns` or `resource`, `JSON.stringify(model)` returns the raw `model.data`. That's fine for internal use and quick scripts; it's a problem the moment a model is returned directly from an HTTP route. Shape your public API output deliberately.

:::

The full pattern — strongly-typed resources, composing resources for loaded relations, `resourceColumns` filter, runtime-swappable shapes — lives in the [Resources guide](../the-basics/resources.md).

## Recap

- **Filter** with `User.where(...)` — equality shorthand, 3-arg operators, chained `AND`, or object form
- **Get one** — `Model.find(id)`, `Model.first(filter?)`, or `.where(...).first()`
- **Order** with `.orderBy(field, direction)`
- **Paginate** with `Model.paginate({ page, limit, filter? })` (or chain off `.where(...).paginate(...)`)
- **Count** with `.count()`; **existence** with `.exists()` / `.notExists()` (cheaper than `count > 0`)
- **Reuse filters** as local or global scopes
- **Shape what gets serialized** via `static toJsonColumns` or `static resource`; default sends every column

## Next

Continue to **[Relationships](./03-relationships.md)** — querying one model is half the story. The other half — loading the related models alongside it, filtering by related conditions, and avoiding N+1 — is next.

## Going further

- **Eager loading and relation queries** (`.with`, `.joinWith`, `.has`, `.whereHas`): [Relationships essentials](./03-relationships.md), [Relationships guide](../digging-deeper/relationships.md)
- **Public API output shaping** (typed resources, computed fields, loaded relations): [Resources guide](../the-basics/resources.md)
- **Scopes deep dive** (timing, bypass, inheritance, parameters): [Scopes guide](../digging-deeper/scopes.md)
- **Cursor pagination, search with filters, complex compound queries**: [Paginated search recipe](../recipes/paginated-search.md)
- **Atomic operations** (`Model.increase` / `decrease` / `atomic`): [Atomic operations guide](../digging-deeper/atomic-operations.md)
- **Joins, JSON fields, vector search, aggregates**: their dedicated guides — [Joins](../digging-deeper/joins.md), [JSON fields](../digging-deeper/json-fields.md), [Vector search](../digging-deeper/vector-search.md), [Aggregates](../digging-deeper/aggregates.md)
