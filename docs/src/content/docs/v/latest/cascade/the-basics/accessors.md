---
title: "Accessors — reading and writing model data"
sidebar:
  order: 4
  label: "Accessors"
---

Cascade models hold their state in a single `data` object. You don't manipulate it directly; you go through the accessor methods. This keeps dirty-tracking, dot-notation paths, and the change pipeline consistent — every read goes through one place, every write goes through another.

This guide is the field-level companion to [CRUD basics](../the-basics/01-crud-basics.md). CRUD covers create/update/delete at the whole-model level; this page covers `get`, `set`, `merge`, `unset`, `increment`, `decrement`, plus the typed shortcuts.

## Reading — `get(field, default?)`

```ts
const user = await User.find(123);

const name = user.get("name"); // any
const email = user.get("email", "n/a"); // any, with default
```

`get` reads a field from the model's data. If the field is absent, it returns the default (or `undefined` if you didn't pass one). This is the canonical reader for instance state.

### Exact types from the schema

Type the model with the schema's output type and `get()` / `set()` know every column:

```ts
import { Model, type ModelData } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";

export const postSchema = v.object({
  title: v.string().required(),
  views: v.int().default(0),
  publishedAt: v.date().nullable(),
  authorId: v.int().required().internal(),
});

export type PostSchema = ModelData<typeof postSchema>;

export class Post extends Model<PostSchema> {
  public static table = "posts";
  public static schema = postSchema;
}

post.get("title"); // string
post.get("views"); // number (a default makes it always present)
post.get("publishedAt"); // Date | null
post.get("publishedAt", new Date()); // Date (the default replaces null/undefined)
post.get("tilte"); // type error: not a column of Post

post.set("views", 10); // ok
post.set("views", "10"); // type error: string is not number
post.set("publishedAt", null); // ok, the column is nullable
```

`ModelData<typeof schema>` is `Infer.Output<typeof schema>`: dates are `Date`, `v.int()` and `v.number()` are `number`, `.nullable()` adds `| null`, `.optional()` adds `undefined`, and `.default()` removes it. A model declared without a schema type (`extends Model`) keeps loose, `any`-typed access, so existing code keeps compiling.

Only top-level columns are typed. A dot path (`"profile.address.city"`) is accepted for any column and returns `any`; pass a type argument when you want one: `post.get<string>("meta.seoTitle")`. The path is not checked on purpose, because a recursive path type is what makes large schemas slow to compile.

### A column is not a property

`post.title` is always `undefined`: the data lives in `post.data`, and the only property shortcuts are `id`, `uuid`, `createdAt` and `updatedAt`. Use `post.get("title")`.

- `warlock check` reports `post.title` reads on Cascade models as `WL9021` and `warlock check --fix` rewrites them to `post.get("title")`.
- In development (any `NODE_ENV` except `production`) Cascade warns once per model and column the first time such a property is read. Nothing is installed in production.

### Read-only snapshots

`toDataSnapshot()` returns a typed, read-only copy of the model's data, without the `hidden` columns. Unlike `toJSON()` it ignores `resource`, `resourceColumns` and `toJsonColumns`, so its type is exactly the schema:

```ts
const snapshot = post.toDataSnapshot(); // ModelDataSnapshot<PostSchema>
snapshot.publishedAt; // Date | null
```

Use `ModelDataSnapshot<PostSchema>` as the input type of a resource or presenter.

### Dot-notation paths

JSON columns and nested objects walk by dot path:

```ts
const city = user.get("profile.address.city");
const firstTag = post.get("tags.0");
```

Same syntax as the query builder's `.where("profile.address.city", ...)`. No driver-specific differences.

### Typed shortcuts

When you know the column's type, the typed shortcuts return the value already narrowed (and default-typed):

```ts
const name = user.string("name"); // string | undefined
const nameOrFallback = user.string("name", "Guest"); // string

const age = user.number("age"); // number | undefined
const isActive = user.boolean("isActive", false); // boolean
```

The unprefixed names (`string`, `number`, `boolean`) keep call sites short. Useful when you want to skip the cast at every read site.

### The `id` shortcut

The primary key shows up so often that Cascade exposes it as a direct property:

```ts
console.log(user.id); // number | string — same as user.get("id")
```

No `.get(...)` needed for `id`. Every other column goes through `get`.

### `has(field)` — is it present?

```ts
if (user.has("profile.avatar")) { ... }
```

Returns `true` if the field exists at the path, including when the value is `null` or an empty string. Distinguishes "the field is missing entirely" from "the field is set but falsy" — useful for soft-deleted, partially-loaded, or sparsely-populated documents.

## Writing — `set(field, value)`

```ts
user.set("name", "Ada Lovelace");
user.set("profile.address.city", "NYC");
await user.save();
```

`set` updates one field. It also marks that field as **dirty** — Cascade knows you changed it and will send it on the next `save()`. Dot-paths work the same as `get`.

`set` returns the model, so you can chain or hand back the instance.

## `merge(values)` — many fields at once

```ts
user.merge({
  name: "Ada",
  email: "ada@example.com",
  profile: { address: { city: "London" } },
});
await user.save();
```

`merge` does a **deep merge** — nested objects are merged, not replaced. So `merge({ profile: { address: { city: "London" } } })` keeps any other keys under `profile.address` (`street`, `postcode`) intact.

If you want a _shallow replace_ instead, set the whole field with `set`:

```ts
user.set("profile", { address: { city: "London" } }); // wipes existing profile
```

Both record dirty state on the affected paths.

## `unset(...fields)` — remove a field

```ts
user.unset("nickname");
user.unset("profile.avatar", "profile.coverImage");
await user.save();
```

Removes the field from the model's data and records it as dirty. On save:

- **MongoDB** — `$unset` operator removes the field from the document.
- **Postgres** — the column is nullified (`UPDATE ... SET column = NULL`).

The semantics differ at the storage layer (Mongo can have _absent_ fields; SQL columns always exist with NULL), but at the model level it's the same: `user.get("nickname")` will return `undefined` afterwards.

## `increment` / `decrement` — atomic-style numeric updates

```ts
user.increment("loginCount"); // +1
user.increment("loginCount", 5); // +5
user.decrement("creditsRemaining", 10);
await user.save();
```

These read the current value (defaulting to `0`), add or subtract, and `set` the new value — all on the model instance. The dirty tracker picks up the change, and `save()` ships it.

:::caution — Instance-level, not race-safe

`model.increment()` is **not** the same as the query-builder `.increment()` you saw in the [Querying essentials](../the-basics/02-querying.md). The instance version reads-then-writes locally; if two processes both load the same row, increment, and save, you'll have a lost-update race.

For race-safe atomic increments across processes, use the **query-builder** form:

```ts
await User.whereId(123).increment("loginCount");
// → UPDATE ... SET loginCount = loginCount + 1 — single statement, no read
```

Rule of thumb: the instance form is fine when _only this request_ is editing the row (validated user profile, single-writer flows). For counters, rate limits, or anything multi-writer, prefer the query-builder form.

:::

## `only(fields)` — pluck a subset

```ts
const summary = user.only(["id", "name", "email"]);
// → { id, name, email } — plain object
```

Returns a plain object containing just the listed fields. Useful for building API responses, fixtures, or comparison snapshots without going through full serialization. Doesn't mark anything dirty — it's a read.

## Default values

When you read a field that isn't set, three sources can populate the default:

1. **The explicit second argument** to `get` / `string` / `number` / `boolean`: `user.get("status", "active")`.
2. **The schema's `.default(...)`** validator on the field: `v.enum([...]).default("active")`. This applies during _write_ — `create()` and `save()` fill in defaults before persisting — so on subsequent reads the field is set, no default needed.
3. **`undefined`** — Cascade doesn't invent values out of nowhere.

The general rule: defaults belong in the **schema** (consistent across every call site), not scattered through `get` calls.

## What about `setData(data)` / `mergeData(data)` for whole-model replacements?

If you have a fresh data object from somewhere and want to swap or merge it into the model wholesale:

```ts
user.merge(freshData); // deep-merge into model.data
```

For a complete overwrite you'd usually create a new model instance rather than mutate an existing one — that's clearer than reaching for low-level state replacement.

## Going further

- **Dirty tracking** — what `set`/`merge`/`unset` record, and how to inspect it: [Dirty tracking guide](../architecture-concepts/dirty-tracking.md)
- **Bulk-row atomic increments** (race-safe) — [Querying essentials](../the-basics/02-querying.md) + [Query Builder API reference](../reference/query-builder-api.md#incrementfield-amount--decrementfield-amount)
- **JSON path operations** — [JSON fields guide](../digging-deeper/json-fields.md)
- **Schema defaults and validation** — validation guide
