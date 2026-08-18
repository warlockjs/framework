---
name: query-data
description: 'Query records via the model — `.where(field, value)` / `.where(field, op, value)`, `.find(id)` / `.first` / `.all`, `.orderBy`, `.count` / `.exists`, plus `.whereIn` / `.whereBetween` / `.whereLike` / `.pluck` / `.firstOrFail` / scopes via `addScope`. Covers filter safety: `where()` rejects `$`-prefixed keys (`UnsafeFilterError`), `whereRaw()` string form rejects `$where`/`$function`/`$accumulator` (`UnsafeRawExpressionError`), and `whereLike`/`whereStartsWith`/`whereEndsWith`/`whereSearch` match string arguments literally (pass a `RegExp` for pattern semantics). Triggers: `.where`, `.find`, `.first`, `.firstOrFail`, `.all`, `.get`, `.orderBy`, `.exists`, `.whereIn`, `.whereBetween`, `.whereLike`, `.whereRaw`, `addScope`, `escapeRegex`, `likePatternToRegexSource`, `UnsafeFilterError`, `UnsafeRawExpressionError`; "filter by status", "find by id", "fetch active users", "check existence", "search box query", "is where() safe from injection"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: pagination — `@warlock.js/cascade/paginate-results/SKILL.md`; aggregates — `@warlock.js/cascade/aggregate-data/SKILL.md`.'
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

### Filters are safe to build from request data — but only through this API

`where(field, value)`, `where(field, "=", value)` and the object form all run the value through a `$`-prefixed-key check before it reaches the driver, so `User.first({ email: req.body.email, password: req.body.password })` throws `UnsafeFilterError` instead of compiling `{ password: { $ne: null } }` into a live MongoDB operator query (the classic NoSQL auth-bypass). This applies to every filter-accepting model static too — `first`, `findFirst`, `findAll`, `count`, `paginate`, `all`, `deleteMany`/`delete`, `deleteOne`, and the atomic/find-and-modify statics in [`perform-atomic-ops`](@warlock.js/cascade/perform-atomic-ops/SKILL.md). Explicit operator APIs (`where(field, operator, value)` for operators other than `=`, `whereIn`/`whereNull`/`whereBetween`/…, object-form `whereRaw({ ... })`) are intentionally not routed through this check — they already express an operator on purpose. Dotted paths (`"profile.name"`) and plain nested-object equality values remain valid; only literal `$`-prefixed keys are rejected. `sanitizeFilter` / `sanitizeFilterValue` are exported if you need the same check on a filter you forward to a driver-level API directly.

```ts
await User.first({ email, password }); // throws UnsafeFilterError if password is `{ $ne: null }`
```

## Raw expressions — `.whereRaw()` / `.orWhereRaw()`

```ts
query.whereRaw({ $expr: { $gt: ["$stock", "$reserved"] } }); // object form — MongoDB
query.whereRaw("age > ?", [30]);                             // string form — SQL, real bindings
```

The **object form** is checked like any other filter value, plus it rejects the server-side-JavaScript operators `$where`, `$function` and `$accumulator` anywhere in the expression (throws `UnsafeRawExpressionError`); `$expr` and the other aggregation operators keep working. The **string form on the MongoDB driver throws `UnsafeRawExpressionError`** — a string used to compile to `{ $where: "<js>" }`, executing arbitrary JavaScript inside `mongod` per scanned document; there is no safe way to parameterize that, so it's rejected outright. Use the object form instead. SQL drivers keep string mode with real `?` bindings (unchanged).

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
| `.whereLike(field, pattern)` / `.whereStartsWith` / `.whereEndsWith` / `.whereSearch` | Pattern matching — see below for literal-vs-regex semantics |
| `.whereHas(relation, callback)` | Filter by conditions on a related model |
| `.sum(field)` / `.avg(field)` / `.min(field)` / `.max(field)` | Aggregates — [`use-aggregates`](@warlock.js/cascade/aggregate-data/SKILL.md) |
| `.distinct(field)` / `.pluck(field)` | Single-field reads (distinct values, flat list) |
| `.chunk(size, callback)` | Stream a large table in batches |
| `.cursorPaginate({ limit, cursor })` | Cursor pagination — [`paginate-results`](@warlock.js/cascade/paginate-results/SKILL.md) |
| `.similarTo(column, embedding)` | Vector similarity — [`use-vector-search`](@warlock.js/cascade/search-by-vector/SKILL.md) |

Each chains off `User.where(...)` or `User.query()` and ends with the appropriate terminator. (`where`, `with`, `joinWith`, `first`, `count`, `find`, `all`, `paginate` are static shortcuts on the model; the rest live on the query builder, so reach them via `User.query()` or by chaining off a static `where`.)

### `whereLike` / `whereSearch` — string arguments match literally

```ts
await User.where(...).whereLike("email", "%@gmail.com").get();      // literal, % still wildcards
await User.query().whereSearch("name", req.query.q).get();          // safe with raw user input
```

A **string** argument to `whereLike`/`whereNotLike`/`whereStartsWith`/`whereEndsWith` (and their `Not` variants) and the `$regex` form of `whereSearch` is escaped and matched as a **literal substring** — the SQL `LIKE` wildcard `%` still expands (to `.*`, runs of `%` collapse), but every other regex metacharacter (`.`, `*`, `+`, `^`, `$`, …) in the string is neutralized. This is what makes `whereSearch("name", req.query.q)` safe to wire directly to a search box: before this, a user-controlled string compiled straight into a MongoDB `$regex`, so `^.*$` matched everything, `^a`/`^b`/… probed a value back one character at a time, and a nested-quantifier pattern like `(a+)+$` triggered catastrophic backtracking (ReDoS) against every scanned document.

An explicit **`RegExp`** argument is still used as a pattern (verbatim, no escaping) — that's how you get real regex semantics — but a `RegExp` can't arrive as JSON, so it only reaches these calls when a developer constructs it in code. **Never build that `RegExp` from user input**; if you need dynamic pattern matching, escape the dynamic parts yourself with the exported `escapeRegex(value)` / `likePatternToRegexSource(pattern)` helpers.

```ts
import { escapeRegex, likePatternToRegexSource } from "@warlock.js/cascade";
```

The Postgres driver was already parameterized (`ILIKE $1`) and is unaffected either way.

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
- Don't build a `RegExp` for `whereLike`/`whereSearch` out of user input — a string argument is already safely escaped; a raw `RegExp` bypasses that and reintroduces the injection/ReDoS risk it closes.
- Don't reach for `whereRaw()` string mode on MongoDB expecting it to still work — it now throws `UnsafeRawExpressionError`; use the object form (`whereRaw({ $expr: … })`).

## See also

- [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md) — `.with(...)`, `.whereHas(...)`, eager loading
- [`@warlock.js/cascade/paginate-results/SKILL.md`](@warlock.js/cascade/paginate-results/SKILL.md) — pagination + cursor + chunk
- [`@warlock.js/cascade/aggregate-data/SKILL.md`](@warlock.js/cascade/aggregate-data/SKILL.md) — `.sum`, `.avg`, `.groupBy`, `.having`
