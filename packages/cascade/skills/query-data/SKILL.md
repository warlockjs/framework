---
name: query-data
description: 'Query records via the model — `.where(field, value)` / `.where(field, op, value)`, `.find(id)` / `.first` / `.all`, `.orderBy`, `.count` / `.exists`, plus `.whereIn` / `.whereBetween` / `.whereLike` / `.pluck` / `.firstOrFail` / scopes via `addScope`. Triggers: `.where`, `.find`, `.first`, `.firstOrFail`, `.all`, `.get`, `.orderBy`, `.exists`, `.whereIn`, `.whereBetween`, `addScope`; "filter by status", "find by id", "fetch active users", "check existence"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: pagination — `@warlock.js/cascade/paginate-results/SKILL.md`; aggregates — `@warlock.js/cascade/aggregate-data/SKILL.md`.'
---

# Query data

The model is the query entry point. No `db.collection("users")`, no `prisma.user.findFirst()`, no repository to import — the class queries itself.

## Filter — `.where()`

### Equality — the shorthand

```ts
const activeUsers = await User.where("status", "active").get();
```

`User.where(field, value)` returns a query builder filtered to that condition. `.get()` runs the query and returns an array of `User` instances.

### Operators

```ts
const adults     = await User.where("age", ">", 18).get();
const recent     = await User.where("created_at", ">=", lastWeek).get();
const nonAdmins  = await User.where("role", "!=", "admin").get();
```

3-argument form. Common operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `like`, `between`. Same syntax across MongoDB and Postgres.

### Compound conditions

```ts
const activeAdmins = await User
  .where("status", "active")
  .where("role", "admin")
  .get();
```

Chained `.where()` calls combine with `AND`.

### Object form

```ts
const targets = await User.where({ status: "active", role: "admin" }).get();
```

Equivalent to chained equalities. Useful when the filter comes from a dynamic source. **Object form only supports equality** — use chained `.where()` for operators.

## Get one record

### By ID

```ts
const user = await User.find(id);  // User | null
```

### First match

```ts
const anyUser    = await User.first();                              // first user, any
const firstAdmin = await User.first({ role: "admin" });             // first admin
const filtered   = await User.where("status", "active").first();    // chain into .first()
```

`.first()` with no args returns the very first record (driver-dependent default order). With a filter object, the first match by equality. Chain off `.where()` when you need operators.

### Throw if missing — `.firstOrFail()`

```ts
const user = await User.where("id", req.params.id).firstOrFail();
```

Throws when nothing matches — useful when you KNOW it should exist and want the error to surface loudly instead of an `undefined`-derived NPE downstream.

**Always handle `null`** from `.find()` and `.first()` — use `?.` or a guard. Resist `!` on query results.

## Order and paginate

```ts
const newest = await User
  .where("status", "active")
  .orderBy("created_at", "desc")
  .get();
```

`.orderBy(field, "asc" | "desc")` sorts. Default direction is `"asc"`. Chain multiple `.orderBy()` for tiebreakers.

For pagination see [`@warlock.js/cascade/paginate-results/SKILL.md`](@warlock.js/cascade/paginate-results/SKILL.md).

## Count and existence

```ts
const total       = await User.count();
const activeCount = await User.count({ status: "active" });
const adminCount  = await User.where("role", "admin").count();

const hasAdmin    = await User.where("role", "admin").exists();      // boolean, short-circuits
const noneBlocked = await User.where("status", "blocked").notExists();
```

**Don't reach for `.count() > 0`** when you only need a boolean — `.exists()` short-circuits on the first matching row. The difference shows up immediately on tables with more than a few thousand rows.

## Get many — `.all(filter?)`

```ts
const allUsers    = await User.all();
const activeUsers = await User.all({ status: "active" });
```

`Model.all(filter?)` is the shortcut for "fetch all records matching a simple equality filter, or every record if no filter."

**Caution.** `.all()` with no filter loads the entire table. Use [pagination](@warlock.js/cascade/paginate-results/SKILL.md) for tables larger than a few hundred rows.

## The wider query vocabulary

Cascade's query builder has around 60 methods. Reach for these as the need arises:

| Reach for | When |
| --- | --- |
| `.whereIn(field, values)` / `.whereNotIn(field, values)` | Match against / exclude a list |
| `.whereNull(field)` / `.whereNotNull(field)` | Nullability checks |
| `.whereBetween(field, [a, b])` | Inclusive range |
| `.whereDate(field, value)`, `.whereDateBetween`, `.whereDateBefore`, `.whereDateAfter` | Date helpers |
| `.whereLike(field, pattern)` / `.whereStartsWith` / `.whereEndsWith` | Pattern matching |
| `.whereHas(relation, callback)` | Filter by conditions on a related model |
| `.sum(field)` / `.avg(field)` / `.min(field)` / `.max(field)` | Aggregates — [`use-aggregates`](@warlock.js/cascade/aggregate-data/SKILL.md) |
| `.distinct(field)` / `.pluck(field)` | Single-field reads (distinct values, flat list) |
| `.chunk(size, callback)` | Stream a large table in batches |
| `.cursorPaginate({ limit, cursor })` | Cursor pagination — [`paginate-results`](@warlock.js/cascade/paginate-results/SKILL.md) |
| `.similarTo(column, embedding)` | Vector similarity — [`use-vector-search`](@warlock.js/cascade/search-by-vector/SKILL.md) |

Each chains off `User.where(...)` or `User.query()` and ends with the appropriate terminator. (`where`, `with`, `joinWith`, `first`, `count`, `find`, `all`, `paginate` are static shortcuts on the model; the rest live on the query builder, so reach them via `User.query()` or by chaining off a static `where`.)

## Scopes — reusable query fragments

When you write the same `.where("status", "active")` across multiple services, define a scope on the model:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;

  static {
    this.addScope("active", (query) => {
      query.where("status", "active");
    });
  }
}

const activeUsers = await User.query().scope("active").get();
```

**Local scopes** (`addScope`) — opt-in, only when you call `.scope("name")`.
**Global scopes** (`addGlobalScope`) — run on every query for that model. Useful for multi-tenancy or default soft-delete filtering. Bypass per-query with `.withoutGlobalScope("name")` / `.withoutGlobalScopes()`.

## Things NOT to do

- Don't `.count() > 0` for existence — use `.exists()`.
- Don't `Model.all()` without a filter on a production table — use pagination or chunking.
- Don't `!` away the null from `.find()` / `.first()` — handle the missing case explicitly or use `.firstOrFail()` when absence is a real error.
- Don't write the same filter chain across multiple services — promote it to a scope.

## See also

- [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md) — `.with(...)`, `.whereHas(...)`, eager loading
- [`@warlock.js/cascade/paginate-results/SKILL.md`](@warlock.js/cascade/paginate-results/SKILL.md) — pagination + cursor + chunk
- [`@warlock.js/cascade/aggregate-data/SKILL.md`](@warlock.js/cascade/aggregate-data/SKILL.md) — `.sum`, `.avg`, `.groupBy`, `.having`
