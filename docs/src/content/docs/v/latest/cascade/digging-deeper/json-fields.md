---
title: "JSON fields"
sidebar:
  order: 8
  label: "JSON fields"
---

Every app eventually stores structured data inside a single column — a `metadata` blob, a `settings` object, an array of `tags`. Cascade gives you a unified set of query methods for reaching into those shapes on **both** MongoDB documents (where everything is JSON-shaped already) and Postgres `jsonb` columns.

The mental model is one sentence: **paths walk the structure**. `profile.address.city` walks `profile` → `address` → `city`. Same syntax on both drivers; Cascade translates to the native operator at execution time.

This page is about the **read side** — filtering, projecting, inspecting JSON paths. Writing nested fields is just `.set("profile.address.city", "NYC")` and is covered in [CRUD basics](../the-basics/01-crud-basics.md).

## Before you reach for these — `.where()` already does dot-notation

Worth stating loudly, because it's the most common case: **the regular `.where()` family supports dot-notation paths today.** Same with `.set()`, `.get()`, `.orderBy()`, `.select()`. For simple equality or operator-based filters on nested fields, you don't need any of the helpers on this page:

```ts
await User.where("profile.address.city", "NYC").get();
await User.where("preferences.theme", "!=", "default").get();
await User.query().orderBy("profile.lastLogin", "desc").get();
```

The helpers in this guide earn their place by doing JSON-specific operations — array containment, key existence, length, type checks. For everything else, the regular query vocabulary already covers it.

## Path syntax

Dot-notation paths walk the structure:

| Path                    | MongoDB                       | Postgres JSONB                  |
| ----------------------- | ----------------------------- | ------------------------------- |
| `profile.address.city`  | `profile.address.city`        | `profile -> 'address' ->> 'city'` |
| `tags`                  | array field                   | `jsonb` array column            |
| `tags.0`                | element `0` of the array      | `tags -> 0`                     |

You don't write the right-hand column. You write the dot-path. Cascade emits the right thing per driver.

## Filtering with JSON helpers

### `whereJsonContains` — value present in array or object

```ts
const taggedJS = await Post.query()
  .whereJsonContains("tags", "javascript")
  .get();

const admins = await User.query()
  .whereJsonContains("profile.roles", "admin")
  .get();
```

Tests whether the JSON value at the path contains the given value. Works on array fields (`tags`) and on object subtrees alike.

### `whereJsonDoesntContain` — inverse

```ts
const notDeprecated = await Post.query()
  .whereJsonDoesntContain("tags", "deprecated")
  .get();
```

The negation. Same shape, opposite outcome.

### `whereJsonContainsKey` — the key is present

```ts
const withAvatar = await User.query()
  .whereJsonContainsKey("profile.avatar")
  .get();
```

Tests whether the path *exists* (the key is present), regardless of its value. Useful for "users who have configured an avatar" versus "users whose avatar happens to be null" — those are different questions.

### `whereJsonLength` — array or object size

```ts
const verbose = await Post.query()
  .whereJsonLength("tags", ">", 5)
  .get();
```

An operator-style filter on the length of an array (or count of keys in an object) at the path. Operators are the same vocabulary as `.where()`: `=`, `!=`, `>`, `>=`, `<`, `<=`.

### `whereJsonIsArray` / `whereJsonIsObject` — type checks

```ts
await User.query().whereJsonIsArray("profile.roles").get();
await User.query().whereJsonIsObject("settings").get();
```

Assert the path resolves to an array (or object). Useful for sanity checks in loosely-shaped JSON where the same field might hold different shapes across rows.

### Array-specific helpers

When the column **is** an array (not just a JSON path that happens to point at one), Cascade exposes a parallel family that reads more naturally:

```ts
// Plain value in an array column
await Post.query().whereArrayContains("tags", "javascript").get();

// Match by key inside an array of objects
await Order.query().whereArrayContains("items", "laptop", "name").get();

// Negation
await User.query().whereArrayNotContains("blocked", userId).get();

// "Has the value OR is empty" — for permissive defaults
await User.query().whereArrayHasOrEmpty("permissions", "admin").get();
await User.query().whereArrayNotHaveOrEmpty("blocked", spammerId).get();

// Array length with an operator
await Post.query().whereArrayLength("tags", ">=", 2).get();
```

:::tip — `whereArray*` vs `whereJson*`

They overlap on plain arrays. Use the `whereArray*` family when the column **is** an array — the names read better and the third `key` argument lets you match inside arrays of objects. Use `whereJson*` when you're navigating a JSON structure that *contains* an array somewhere inside it.

:::

## Projecting JSON paths

### `selectJson(path, alias?)`

```ts
const compact = await User.query()
  .selectJson("profile.address.city", "city")
  .get();
// each row: { city: "..." }
```

Projects a nested JSON path into a top-level alias on each result row. Saves transferring the entire JSON column over the wire when you only need one nested value out of it.

### `selectJsonRaw(path, expression, alias)`

```ts
query.selectJsonRaw(
  "stats.views",
  { $ifNull: ["$stats.views", 0] },
  "views",
);
```

Apply a driver-native expression to a JSON path under an alias. Useful for coalescing, defaults, or any computation that needs more than a plain projection — `$ifNull` on Mongo, `COALESCE(...)` on Postgres.

### `deselectJson(path)`

```ts
query.deselectJson("profile.ssn");
```

Exclude a nested JSON path from the projection. Useful for stripping sensitive nested data without rewriting the whole select.

## A complete worked example

Pulling filter + projection + the rest of the query API together:

```ts
const writers = await User.query()
  .whereJsonContains("profile.roles", "writer")
  .whereJsonLength("preferences.notifications", ">", 0)
  .selectJson("profile.address.city", "city")
  .select(["id", "name"])
  .get();
// each row: { id, name, city }
```

In English: *find users tagged as "writer" who have at least one notification preference, and return just their id, name, and city.* One query. Both drivers. No driver-specific syntax in the call site.

## Driver translation reference

If you're reading existing raw SQL or Mongo queries and translating to Cascade (or the other way around), here's the Rosetta:

| Cascade helper                          | MongoDB                          | Postgres JSONB                |
| --------------------------------------- | -------------------------------- | ----------------------------- |
| `whereJsonContains("tags", v)`          | `{ tags: v }` / `$in`            | `tags @> v::jsonb`            |
| `whereJsonContainsKey("a.b")`           | `{ "a.b": { $exists: true } }`   | `jsonb_path_exists`           |
| `whereJsonLength("tags", ">", 5)`       | `$expr` + `$size`                | `jsonb_array_length`          |
| `whereJsonIsArray("tags")`              | `{ tags: { $type: "array" } }`   | `jsonb_typeof(tags) = 'array'` |
| `selectJson("a.b", "alias")`            | `$project: { alias: "$a.b" }`    | `a -> 'b' AS alias`           |

The takeaway: Cascade is the abstraction; the driver emits whatever its engine speaks.

## A note on indexes

Filtering on JSON paths gets *enormously* cheaper when the path is indexed. On MongoDB, a regular field index on a dot-path works (`db.users.createIndex({ "profile.roles": 1 })`). On Postgres, JSONB columns want a **GIN index** for containment queries (`@>`). Without an index, the database has to scan and decode every row.

If you've got a JSON path that's hot in queries, declare an index for it. The migrations layer covers index creation; see the migrations guide once Cascade ships full index docs.

## Going further

- **Writing nested JSON paths** (`.set("profile.address.city", "NYC")`) — [CRUD basics](../the-basics/01-crud-basics.md)
- **Indexing JSON paths** — migrations guide
- **Driver-specific JSONB / aggregation tricks** beyond the structured helpers — expressions guide
