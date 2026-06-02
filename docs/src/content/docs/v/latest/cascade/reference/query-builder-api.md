---
title: "Query Builder API"
sidebar:
  order: 2
  label: "Query Builder API"
---

This page documents every method on Cascade's `QueryBuilderContract`. It's a **reference**, not a tutorial — each method shows its signature, a one-sentence description, a minimal example, and a link to the guide that teaches the concept.

Use the in-page anchors (or Ctrl-F) when you know the name and just need the signature. For the *why* and *when*, follow the **See also** links into the essentials and guide pages.

:::info — How method blocks are organised

Each method shows:
- **Signature** — the TypeScript signature(s) you can call
- **What it does** — one sentence, mechanical
- **Example** — one minimal snippet
- **See also** — the guide that teaches the concept

Methods are grouped by purpose (where, select, joins, ordering, ...) and alphabetised within each group.

:::

---

## Scopes

### `scope(name, ...args)`

```ts
scope(scopeName: string, ...args: any[]): this
```

**What it does:** apply a local scope defined on the model.

```ts
await User.query().scope("active").get();
```

**See also:** [Querying essentials](../the-basics/02-querying.md)

### `withoutGlobalScope(...names)`

```ts
withoutGlobalScope(...scopeNames: string[]): this
```

**What it does:** disable one or more global scopes for this query.

```ts
await User.query().withoutGlobalScope("tenant").get();
```

### `withoutGlobalScopes()`

```ts
withoutGlobalScopes(): this
```

**What it does:** disable all global scopes for this query.

```ts
await User.query().withoutGlobalScopes().get();
```

---

## Where clauses

### `where(...)`

```ts
where(field: string, value: unknown): this
where(field: string, operator: WhereOperator, value: unknown): this
where(conditions: WhereObject): this
where(callback: WhereCallback<T>): this
```

**What it does:** add a where clause. Four forms — equality, operator, object, callback.

```ts
await User.where("age", ">", 18).get();
await User.where({ status: "active", role: "admin" }).get();
```

**See also:** [Querying essentials](../the-basics/02-querying.md)

### `orWhere(...)`

```ts
orWhere(field: string, value: unknown): this
orWhere(field: string, operator: WhereOperator, value: unknown): this
orWhere(conditions: WhereObject): this
orWhere(callback: WhereCallback<T>): this
```

**What it does:** same shapes as `where`, joined with OR.

```ts
await User.where("role", "admin").orWhere("role", "moderator").get();
```

### `whereIn(field, values)` / `whereNotIn(field, values)`

```ts
whereIn(field: string, values: unknown[]): this
whereNotIn(field: string, values: unknown[]): this
```

**What it does:** match where `field` is (or isn't) any value in the list.

```ts
await User.whereIn("status", ["active", "pending"]).get();
```

### `whereNull(field)` / `whereNotNull(field)`

```ts
whereNull(field: string): this
whereNotNull(field: string): this
```

**What it does:** constrain the field to be NULL or NOT NULL.

```ts
await User.whereNotNull("emailVerifiedAt").get();
```

### `whereBetween(field, range)` / `whereNotBetween(field, range)`

```ts
whereBetween(field: string, range: [unknown, unknown]): this
whereNotBetween(field: string, range: [unknown, unknown]): this
```

**What it does:** constrain the field to fall inside (or outside) the inclusive range.

```ts
await User.whereBetween("age", [18, 65]).get();
```

### `whereLike` / `whereNotLike` / `whereStartsWith` / `whereNotStartsWith` / `whereEndsWith` / `whereNotEndsWith`

```ts
whereLike(field: string, pattern: RegExp | string): this
whereNotLike(field: string, pattern: string): this
whereStartsWith(field: string, value: string | number): this
whereNotStartsWith(field: string, value: string | number): this
whereEndsWith(field: string, value: string | number): this
whereNotEndsWith(field: string, value: string | number): this
```

**What it does:** pattern-match (or anti-match) on a string field. Case-insensitive.

```ts
await User.whereLike("name", "%john%").get();
await User.whereStartsWith("email", "admin@").get();
```

### `whereDate` / `whereDateEquals` / `whereDateBefore` / `whereDateAfter` / `whereDateBetween` / `whereDateNotBetween`

```ts
whereDate(field: string, value: Date | string): this
whereDateEquals(field: string, value: Date | string): this
whereDateBefore(field: string, value: Date | string): this
whereDateAfter(field: string, value: Date | string): this
whereDateBetween(field: string, range: [Date, Date]): this
whereDateNotBetween(field: string, range: [Date, Date]): this
```

**What it does:** filter on a date field — exact day, before/after, or a range. Time portion is ignored for the day-equality variants.

```ts
await Order.whereDateBetween("createdAt", [start, end]).get();
```

### `whereTime` / `whereDay` / `whereMonth` / `whereYear`

```ts
whereTime(field: string, value: string): this
whereDay(field: string, value: number): this
whereMonth(field: string, value: number): this
whereYear(field: string, value: number): this
```

**What it does:** filter on an extracted part of a date field.

```ts
await Event.whereMonth("startsAt", 12).get();
```

### `whereId(value)` / `whereIds(values)` / `whereUuid(value)` / `whereUlid(value)`

```ts
whereId(value: string | number): this
whereIds(values: Array<string | number>): this
whereUuid(value: string): this
whereUlid(value: string): this
```

**What it does:** shortcuts for filtering by primary key (single, multiple, or by id-type variant).

```ts
await User.whereIds([1, 2, 3]).get();
```

### `whereFullText` / `orWhereFullText` / `whereSearch` / `textSearch`

```ts
whereFullText(fields: string | string[], query: string): this
orWhereFullText(fields: string | string[], query: string): this
whereSearch(field: string, query: string): this
textSearch(query: string, filters?: WhereObject): this
```

**What it does:** full-text search variants. `whereFullText` constrains specific fields; `textSearch` does a driver-native full-text query with optional filters.

```ts
await Post.whereFullText(["title", "body"], "cascade orm").get();
```

### `whereNot(callback)` / `orWhereNot(callback)`

```ts
whereNot(callback: WhereCallback<T>): this
orWhereNot(callback: WhereCallback<T>): this
```

**What it does:** negate a nested predicate block.

```ts
await User.whereNot(q => q.where("status", "banned")).get();
```

### `whereExists(...)` / `whereNotExists(...)`

```ts
whereExists(callback: WhereCallback<T>): this
whereExists(field: string): this
whereNotExists(callback: WhereCallback<T>): this
whereNotExists(field: string): this
```

**What it does:** existence check — either a nested condition exists, or (MongoDB-style) the field itself is present in the document.

```ts
await User.whereExists("optionalField").get();
await User.whereExists(q => q.where("status", "active")).get();
```

### `whereColumn` / `orWhereColumn` / `whereColumns` / `whereBetweenColumns`

```ts
whereColumn(first: string, operator: WhereOperator, second: string): this
orWhereColumn(first: string, operator: WhereOperator, second: string): this
whereColumns(comparisons: Array<[string, WhereOperator, string]>): this
whereBetweenColumns(field: string, lowerColumn: string, upperColumn: string): this
```

**What it does:** compare one column to another, instead of to a literal value.

```ts
await Product.whereColumn("stock", ">", "reserved").get();
```

### `whereSize(field, size)` / `whereSize(field, operator, size)`

```ts
whereSize(field: string, size: number): this
whereSize(field: string, operator: ">" | ">=" | "=" | "<" | "<=", size: number): this
```

**What it does:** filter on the size of an array/collection field.

```ts
await Post.whereSize("tags", ">", 0).get();
```

### `whereRaw(expression, bindings?)` / `orWhereRaw(expression, bindings?)`

```ts
whereRaw(expression: RawExpression, bindings?: unknown[]): this
orWhereRaw(expression: RawExpression, bindings?: unknown[]): this
```

**What it does:** drop into the driver's native query language for a where clause Cascade can't express.

```ts
await User.whereRaw("this.age > ?", [30]).get();
```

---

## JSON & array helpers

### `whereJsonContains(path, value)` / `whereJsonDoesntContain(path, value)`

```ts
whereJsonContains(path: string, value: unknown): this
whereJsonDoesntContain(path: string, value: unknown): this
```

**What it does:** test whether a JSON path contains a given value.

```ts
await Post.whereJsonContains("tags", "javascript").get();
```

**See also:** [JSON fields guide](../digging-deeper/json-fields.md)

### `whereJsonContainsKey(path)`

```ts
whereJsonContainsKey(path: string): this
```

**What it does:** test whether a JSON path exists (key is present).

```ts
await User.whereJsonContainsKey("profile.avatar").get();
```

### `whereJsonLength(path, operator, value)`

```ts
whereJsonLength(path: string, operator: WhereOperator, value: number): this
```

**What it does:** filter on the length of an array or object at a JSON path.

```ts
await Post.whereJsonLength("tags", ">", 3).get();
```

### `whereJsonIsArray(path)` / `whereJsonIsObject(path)`

```ts
whereJsonIsArray(path: string): this
whereJsonIsObject(path: string): this
```

**What it does:** assert the value at a JSON path is of the expected shape.

```ts
await User.whereJsonIsArray("profile.roles").get();
```

### `whereArrayContains` / `whereArrayNotContains` / `whereArrayHasOrEmpty` / `whereArrayNotHaveOrEmpty`

```ts
whereArrayContains(field: string, value: unknown, key?: string): this
whereArrayNotContains(field: string, value: unknown, key?: string): this
whereArrayHasOrEmpty(field: string, value: unknown, key?: string): this
whereArrayNotHaveOrEmpty(field: string, value: unknown, key?: string): this
```

**What it does:** array-flavoured containment checks. The optional `key` argument matches on a nested property when the array holds objects.

```ts
await Post.whereArrayContains("tags", "javascript").get();
await Order.whereArrayContains("items", "laptop", "name").get();
```

### `whereArrayLength(field, operator, value)`

```ts
whereArrayLength(field: string, operator: WhereOperator, value: number): this
```

**What it does:** filter on the length of an array column.

```ts
await User.whereArrayLength("roles", ">=", 2).get();
```

---

## Select / projection

### `select(...)`

```ts
select(fields: string[]): this
select(fields: Record<string, 0 | 1 | boolean>): this
select(...fields: Array<string | string[]>): this
```

**What it does:** choose which columns/fields the query returns. Four call shapes — array, projection object, rest-args, or mixed.

```ts
await User.query().select(["name", "email"]).get();
```

**See also:** [Querying essentials](../the-basics/02-querying.md)

### `selectAs(field, alias)`

```ts
selectAs(field: string, alias: string): this
```

**What it does:** select a single field under a new alias.

```ts
query.selectAs("name", "fullName");
```

### `addSelect(fields)`

```ts
addSelect(fields: string[]): this
```

**What it does:** append fields to the existing projection without clearing it.

```ts
query.select(["name", "email"]).addSelect(["age"]);
```

### `selectRaw(expression, bindings?)` / `selectRawMany(definitions)`

```ts
selectRaw(expression: RawExpression, bindings?: unknown[]): this
selectRawMany(definitions: Array<{ alias: string; expression: RawExpression; bindings?: unknown[] }>): this
```

**What it does:** add a raw projection expression (`selectRaw`), or several at once (`selectRawMany`).

```ts
query.selectRaw({ total: { $sum: "$items.price" } });
```

### `selectSub(expression, alias)` / `addSelectSub(expression, alias)`

```ts
selectSub(expression: RawExpression, alias: string): this
addSelectSub(expression: RawExpression, alias: string): this
```

**What it does:** inject a sub-select expression under an alias. `addSelectSub` does the same without clearing existing selects.

```ts
query.selectSub({ $sum: "$items.price" }, "itemsTotal");
```

### `selectAggregate(field, aggregate, alias)`

```ts
selectAggregate(
  field: string,
  aggregate: "sum" | "avg" | "min" | "max" | "count" | "first" | "last",
  alias: string,
): this
```

**What it does:** project a single aggregate as a named field on the result.

```ts
query.selectAggregate("items.price", "sum", "itemsTotal");
```

**See also:** Aggregates guide

### `selectExists(field, alias)` / `selectCount(field, alias)`

```ts
selectExists(field: string, alias: string): this
selectCount(field: string, alias: string): this
```

**What it does:** project a boolean (`selectExists`) or a count (`selectCount`) of items at a path.

```ts
query.selectExists("deletedAt", "isDeleted");
query.selectCount("permissions", "permissionsCount");
```

### `selectCase(cases, otherwise, alias)` / `selectWhen(condition, then, else, alias)`

```ts
selectCase(
  cases: Array<{ when: RawExpression; then: RawExpression | unknown }>,
  otherwise: RawExpression | unknown,
  alias: string,
): this
selectWhen(
  condition: RawExpression,
  thenValue: RawExpression | unknown,
  elseValue: RawExpression | unknown,
  alias: string,
): this
```

**What it does:** project a CASE/switch expression. `selectWhen` is the single-condition shortcut.

```ts
query.selectWhen({ $gt: ["$age", 18] }, "Adult", "Minor", "ageLabel");
```

### `selectJson(path, alias?)` / `selectJsonRaw(path, expression, alias)` / `deselectJson(path)`

```ts
selectJson(path: string, alias?: string): this
selectJsonRaw(path: string, expression: RawExpression, alias: string): this
deselectJson(path: string): this
```

**What it does:** project a nested JSON path (`selectJson`), apply a raw expression to it (`selectJsonRaw`), or exclude it (`deselectJson`).

```ts
query.selectJson("profile.address.city", "city");
```

**See also:** [JSON fields guide](../digging-deeper/json-fields.md)

### `selectConcat(fields, alias)` / `selectCoalesce(fields, alias)`

```ts
selectConcat(fields: Array<string | RawExpression>, alias: string): this
selectCoalesce(fields: Array<string | RawExpression>, alias: string): this
```

**What it does:** project a concatenation, or the first non-null among several values.

```ts
query.selectConcat(["$firstName", " ", "$lastName"], "fullName");
query.selectCoalesce(["$nickname", "$name"], "displayName");
```

### `selectWindow(spec)`

```ts
selectWindow(spec: RawExpression): this
```

**What it does:** attach a window function expression to the projection (rank, partition aggregates, running totals, ...).

```ts
query.selectWindow({
  partitionBy: "$category",
  sortBy: { createdAt: 1 },
  output: { rank: { $denseRank: {} } },
});
```

### `selectDriverProjection(callback)`

```ts
selectDriverProjection(callback: (projection: Record<string, unknown>) => void): this
```

**What it does:** mutate the driver's underlying projection object directly. Last-resort escape hatch.

```ts
query.selectDriverProjection(p => { p.score = { $meta: "textScore" }; });
```

### `deselect(fields)` / `clearSelect()` / `selectAll()` / `selectDefault()`

```ts
deselect(fields: string[]): this
clearSelect(): this
selectAll(): this
selectDefault(): this
```

**What it does:** exclude specific fields (`deselect`), or reset the projection. `clearSelect`, `selectAll`, and `selectDefault` all restore the "all columns" default.

```ts
query.deselect(["password", "token"]);
```

### `distinctValues(fields?)`

```ts
distinctValues(fields?: string | string[]): this
```

**What it does:** mark the query as returning distinct rows for the given fields.

```ts
query.distinctValues(["category", "status"]);
```

---

## Joins

### `join(table, localField, foreignField)` / `join(options)`

```ts
join(table: string, localField: string, foreignField: string): this
join(options: JoinOptions): this
```

**What it does:** INNER JOIN on SQL; `$lookup` on MongoDB (which is inherently left-flavoured — see the joins guide).

```ts
query.join("profiles", "id", "user_id");
```

**See also:** [Joins guide](../digging-deeper/joins.md)

### `innerJoin(table, localField, foreignField)` / `innerJoin(options)`

```ts
innerJoin(table: string, localField: string, foreignField: string): this
innerJoin(options: JoinOptions): this
```

**What it does:** explicit INNER JOIN with cross-driver semantics (MongoDB adds a `$match` to drop empty joins).

### `leftJoin(table, localField, foreignField)` / `leftJoin(options)`

```ts
leftJoin(table: string, localField: string, foreignField: string): this
leftJoin(options: JoinOptions): this
```

**What it does:** LEFT JOIN — keep every row on the left, fill nulls on the right when there's no match.

### `rightJoin(table, localField, foreignField)` / `rightJoin(options)`

```ts
rightJoin(table: string, localField: string, foreignField: string): this
rightJoin(options: JoinOptions): this
```

**What it does:** RIGHT JOIN on SQL. **Silently emulated as LEFT JOIN on MongoDB** — see the joins guide before using.

### `fullJoin(table, localField, foreignField)` / `fullJoin(options)`

```ts
fullJoin(table: string, localField: string, foreignField: string): this
fullJoin(options: JoinOptions): this
```

**What it does:** FULL OUTER JOIN on SQL. **Silently emulated as LEFT JOIN on MongoDB** — see the joins guide.

### `crossJoin(table)`

```ts
crossJoin(table: string): this
```

**What it does:** Cartesian product. Every row on the left × every row on the right.

```ts
query.crossJoin("colors");
```

### `joinRaw(expression, bindings?)`

```ts
joinRaw(expression: RawExpression, bindings?: unknown[]): this
```

**What it does:** raw join expression in driver-native syntax. Use for `$graphLookup`, lateral joins, anything the structured methods can't express.

```ts
query.joinRaw("LEFT JOIN LATERAL (...) e ON true");
```

---

## Relations & eager loading

### `with(...)`

```ts
with(relation: string): this
with(...relations: string[]): this
with(relation: string, constraint: (query: QueryBuilderContract) => void): this
with(relations: Record<string, boolean | ((query: QueryBuilderContract) => void)>): this
```

**What it does:** eager-load related models in separate, optimised queries (avoids N+1).

```ts
await User.query().with("posts", "organization").find(1);
await User.query()
  .with({ posts: q => q.where("isPublished", true) })
  .find(1);
```

**See also:** [Relationships essentials](../the-basics/03-relationships.md)

### `joinWith(...relations)`

```ts
joinWith(...relations: string[]): this
```

**What it does:** load relations via JOIN (single query) instead of separate queries. Best for `belongsTo` / `hasOne`.

```ts
const post = await Post.joinWith("author").first();
```

### `withCount(...)`

```ts
withCount(relation: string): this
withCount(...relations: string[]): this
withCount(relations: string[]): this
withCount(relations: Record<string, true | string | ((query: QueryBuilderContract) => void)>): this
```

**What it does:** project the count of a related model as a virtual field. Default alias `${relation}Count`; override with `as <alias>` or the object value form.

```ts
await User.query().withCount("posts").get();
await Post.query()
  .withCount({
    comments: true,
    "comments as approvedCount": q => q.where("approved", true),
  })
  .get();
```

### `has(relation)` / `has(relation, operator, count)`

```ts
has(relation: string): this
has(relation: string, operator: string, count: number): this
```

**What it does:** filter results to those that have related models (with optional count constraint).

```ts
await User.query().has("posts").get();
await User.query().has("posts", ">=", 5).get();
```

### `whereHas(relation, callback)` / `doesntHave(relation)` / `whereDoesntHave(relation, callback)`

```ts
whereHas(relation: string, callback: (query: QueryBuilderContract) => void): this
doesntHave(relation: string): this
whereDoesntHave(relation: string, callback: (query: QueryBuilderContract) => void): this
```

**What it does:** existence/non-existence checks on relations, with optional callback to constrain the related query.

```ts
await User.query()
  .whereHas("posts", q => q.where("isPublished", true))
  .get();
```

---

## Ordering

### `orderBy(field, direction?)` / `orderBy(fields)`

```ts
orderBy(field: string, direction?: OrderDirection): this
orderBy(fields: Record<string, OrderDirection>): this
```

**What it does:** order results by one or more fields.

```ts
await User.query().orderBy("createdAt", "desc").get();
await User.query().orderBy({ status: "asc", createdAt: "desc" }).get();
```

**See also:** [Querying essentials](../the-basics/02-querying.md)

### `orderByDesc(field)`

```ts
orderByDesc(field: string): this
```

**What it does:** descending shortcut for `orderBy(field, "desc")`.

### `orderByRaw(expression, bindings?)`

```ts
orderByRaw(expression: RawExpression, bindings?: unknown[]): this
```

**What it does:** order by a raw driver expression.

```ts
query.orderByRaw("RANDOM()");
```

### `orderByRandom(limit)`

```ts
orderByRandom(limit: number): this
```

**What it does:** randomly order results; takes a limit to avoid scanning the whole table.

### `latest(column?)` / `oldest(column?)`

```ts
latest(column?: string): Promise<T[]>
oldest(column?: string): this
```

**What it does:** order by a timestamp column descending (`latest`) or ascending (`oldest`). Default column is `createdAt`. Note: `latest` is a terminator and returns the records directly.

```ts
const newest = await Post.query().latest();
```

---

## Limiting & pagination

### `limit(value)` / `take(value)`

```ts
limit(value: number): this
take(value: number): this
```

**What it does:** cap the number of returned rows. `take` is an alias.

### `skip(value)` / `offset(value)`

```ts
skip(value: number): this
offset(value: number): this
```

**What it does:** skip the given number of rows. Aliases for each other.

### `cursor(after?, before?)`

```ts
cursor(after?: unknown, before?: unknown): this
```

**What it does:** apply cursor-pagination hints. Pair with `cursorPaginate` for the full pattern.

### `paginate(options)`

```ts
paginate(options: PaginationOptions): Promise<PaginationResult<T>>
```

**What it does:** terminator — page/limit pagination with total + page count.

```ts
const result = await User.query().paginate({ page: 1, limit: 10 });
// { data, pagination: { total, page, limit, pages } }
```

**See also:** [Querying essentials](../the-basics/02-querying.md)

### `cursorPaginate(options)`

```ts
cursorPaginate(options: CursorPaginationOptions): Promise<CursorPaginationResult<T>>
```

**What it does:** terminator — cursor-based pagination. Better than offset for large result sets and infinite-scroll UIs.

```ts
const result = await User.query().cursorPaginate({ limit: 10, cursor: lastId });
// { data, pagination: { hasMore, nextCursor, ... } }
```

### `chunk(size, callback)`

```ts
chunk(size: number, callback: ChunkCallback<T>): Promise<void>
```

**What it does:** terminator — iterate through results in chunks. Callback returns `false` to stop.

```ts
await User.query().chunk(100, async (users, index) => {
  await processUsers(users);
});
```

---

## Grouping & aggregation

### `groupBy(fields)` / `groupBy(fields, aggregates)`

```ts
groupBy(fields: GroupByInput): this
groupBy(fields: GroupByInput, aggregates: Record<string, RawExpression>): this
```

**What it does:** group results by one or more fields, with optional aggregate output. Works on both MongoDB and Postgres. The driver-agnostic `$agg.count/sum/avg/min/max` are cross-driver; `$agg.distinct/floor/first/last` are MongoDB-only and throw on Postgres (see the [Aggregates guide](../digging-deeper/aggregates.md)).

```ts
import { $agg } from "@warlock.js/cascade";

query.groupBy("category", {
  total: $agg.sum("amount"),
  count: $agg.count(),
});
```

**See also:** [Aggregates guide](../digging-deeper/aggregates.md)

### `groupByRaw(expression, bindings?)`

```ts
groupByRaw(expression: RawExpression, bindings?: unknown[]): this
```

**What it does:** group by a raw expression (`DATE(createdAt)`, custom JSON path, ...).

### `having(...)` / `havingRaw(expression, bindings?)`

```ts
having(field: string, value: unknown): this
having(field: string, operator: WhereOperator, value: unknown): this
having(condition: HavingInput): this
havingRaw(expression: RawExpression, bindings?: unknown[]): this
```

**What it does:** filter the grouped/aggregated results (vs `.where()` which filters before grouping).

```ts
query.groupBy("category", { total: $agg.sum("amount") })
     .having("total", ">", 1000);
```

---

## Execution / terminators

### `get<Output>()`

```ts
get<Output = T>(): Promise<Output[]>
```

**What it does:** execute the query and return all matching records.

```ts
const users = await User.query().where("isActive", true).get();
```

### `first<Output>()` / `firstOrFail<Output>()`

```ts
first<Output = T>(): Promise<Output | null>
firstOrFail<Output = T>(): Promise<Output>
```

**What it does:** return the first matching record (or `null` / throw if none).

```ts
const user = await User.where("email", "john@example.com").first();
```

### `last<Output>(field?)`

```ts
last<Output = T>(field?: string): Promise<Output | null>
```

**What it does:** return the last record by the given field (default: primary key descending).

### `count()`

```ts
count(): Promise<number>
```

**What it does:** count matching records.

```ts
const total = await User.where("isActive", true).count();
```

### `sum(field)` / `avg(field)` / `min(field)` / `max(field)`

```ts
sum(field: string): Promise<number>
avg(field: string): Promise<number>
min(field: string): Promise<number>
max(field: string): Promise<number>
```

**What it does:** scalar aggregates over the matched rows. Each returns a `Promise<number>`.

```ts
const revenue = await Order.where("status", "completed").sum("amount");
```

### `distinct<T>(field)` / `countDistinct(field)`

```ts
distinct<T = unknown>(field: string): Promise<T[]>
countDistinct(field: string): Promise<number>
```

**What it does:** distinct values for a field (`distinct` returns the values; `countDistinct` returns the count of distinct values).

```ts
const categories = await Product.query().distinct<string>("category");
```

### `pluck(field)`

```ts
pluck(field: string): Promise<unknown[]>
```

**What it does:** retrieve a flat array of a single field's values across all matching rows.

```ts
const names = await User.query().pluck("name");
```

### `value<T>(field)`

```ts
value<T = unknown>(field: string): Promise<T | null>
```

**What it does:** scalar — retrieve a single field's value from the first matching row.

```ts
const email = await User.whereId(123).value<string>("email");
```

### `exists()` / `notExists()`

```ts
exists(): Promise<boolean>
notExists(): Promise<boolean>
```

**What it does:** does any row (or no row) match? Cheaper than `count() > 0`.

```ts
const hasActiveUsers = await User.where("isActive", true).exists();
```

### `increment(field, amount?)` / `decrement(field, amount?)`

```ts
increment(field: string, amount?: number): Promise<number>
decrement(field: string, amount?: number): Promise<number>
```

**What it does:** atomically increment/decrement a field. Returns the new value. Default amount: 1.

```ts
await User.whereId(123).increment("loginCount");
```

### `incrementMany(field, amount?)` / `decrementMany(field, amount?)`

```ts
incrementMany(field: string, amount?: number): Promise<number>
decrementMany(field: string, amount?: number): Promise<number>
```

**What it does:** apply the increment/decrement to every matching row. Returns the number of rows modified.

---

## Inspection & debugging

### `parse()`

```ts
parse(): DriverQuery
```

**What it does:** return the driver-native query without executing. SQL drivers populate `{ query, bindings }`; MongoDB populates `{ pipeline }`.

```ts
const { query, bindings } = User.where("age", ">", 18).parse();
```

### `pretty()`

```ts
pretty(): string
```

**What it does:** formatted string representation of the parsed query.

### `explain()`

```ts
explain(): Promise<unknown>
```

**What it does:** ask the driver for the query's execution plan.

```ts
const plan = await User.where("status", "active").explain();
```

---

## Lifecycle hooks

### `onFetching(callback)`

```ts
onFetching(callback: (query: this) => void | Promise<void>): () => void
```

**What it does:** register a callback to run before query execution. Returns an unsubscribe function.

### `onHydrating(callback)`

```ts
onHydrating(callback: (records: any[], context: any) => void | Promise<void>): () => void
```

**What it does:** register a callback to run after fetching raw rows but before hydrating them into model instances.

### `onFetched(callback)`

```ts
onFetched(callback: (records: any[], context: any) => void | Promise<void>): () => void
```

**What it does:** register a callback to run after hydration. Receives the hydrated model instances.

### `hydrate(callback)`

```ts
hydrate(callback: (data: any, index: number) => any): this
```

**What it does:** transform each result row during hydration.

---

## Utility

### `tap(callback)`

```ts
tap(callback: (builder: this) => void): this
```

**What it does:** side-effect into the chain (logging, debugging) without breaking the fluent flow.

```ts
query.where("age", ">", 18).tap(q => console.log(q.parse())).get();
```

### `when<V>(condition, callback, otherwise?)`

```ts
when<V>(
  condition: V | boolean | (() => boolean),
  callback: (builder: this, value: V) => void,
  otherwise?: (builder: this) => void,
): this
```

**What it does:** conditionally apply a callback to the query. Useful for optional filters from controller input.

```ts
query.when(searchTerm, (q, term) => q.whereLike("name", term));
```

### `clone()`

```ts
clone(): this
```

**What it does:** duplicate the query builder so you can branch off without mutating the original.

```ts
const base = User.query().where("isActive", true);
const admins = base.clone().where("role", "admin");
```

### `raw(builder)`

```ts
raw(builder: (native: unknown) => unknown): this
```

**What it does:** mutate the underlying native query object directly. Last-resort escape hatch.

### `extend<R>(extension, ...args)`

```ts
extend<R>(extension: string, ...args: unknown[]): R
```

**What it does:** invoke a driver-specific extension registered with the query builder.

---

## Specialty

### `similarTo(column, embedding, alias?)`

```ts
similarTo(column: string, embedding: number[], alias?: string): this
```

**What it does:** nearest-neighbour vector similarity search. Adds a similarity score to the SELECT and an ORDER BY on the same expression so the vector index can be used. Default score alias `"score"`.

```ts
const results = await Vector.query()
  .where({ organization_id: orgId, content_type: "summary" })
  .similarTo("embedding", queryEmbedding)
  .limit(5)
  .get<VectorRow & { score: number }>();
```

**See also:** [Vector search guide](../digging-deeper/vector-search.md)
