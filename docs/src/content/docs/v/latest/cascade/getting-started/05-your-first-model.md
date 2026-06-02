---
title: "Your first model"
sidebar:
  order: 5
  label: "Your first model"
---

This is the page where Cascade actually does something. You'll define a schema, attach it to a class, write a record, and read it back. End-to-end, four steps, one file. By the time you're done, you've created Ada Lovelace and fished her back out of the database — and the patterns underneath are exactly the same ones every model in your app will use.

## Prerequisites

- [Cascade installed](./02-installation.md), [configured](./03-configuration.md), and [`connectToDatabase` called](./03-configuration.md#connect) at boot
- The [users table](./04-migrations-intro.md) created via migration

## Step 1 — Define the schema

The schema is your single declaration of what a `User` looks like. Same `v.object` does triple duty later: validates incoming data, infers the TypeScript type, and is the shape your table writes against.

```ts
// src/app/users/models/user/user.model.ts
import { v, type Infer } from "@warlock.js/seal";

export const userSchema = v.object({
  name: v.string(),
  email: v.string().email(),
  status: v.enum(["active", "inactive"]).default("active"),
});

type UserSchema = Infer<typeof userSchema>;
```

Four things to notice:

- `v.object({...})` builds the schema. `.email()`, `.default(...)` are seal validators that configure how each field is checked at save time. Fields are **required by default** — chain `.optional()` on any field that should be allowed to be missing or null.
- `Infer<typeof userSchema>` derives the TypeScript type from the schema. No second declaration, no drift — change the schema, the type updates automatically.
- The schema is **standalone** — `userSchema` is a regular seal validator object, so you can reuse it anywhere you need to validate user-shaped data (request bodies, service inputs, etc.). See the [seal docs](https://github.com/warlockjs/seal) for the validation API.
- `seal` is `@warlock.js/seal`, Cascade's validation library. The seal docs cover the full validator vocabulary when you need it.

:::tip — this minimal schema grows as you go

Later pages reference fields that aren't in this kickoff schema — `image`, `age`, `role`, `online_state`, etc. Extend `userSchema` as you follow along so the snippets compile against your model. The three fields above are the *minimum* to get a working first record; nothing more is required for this page.

:::

## Step 2 — Define the model class

Append the class to the same file. One decorator, two statics, and you have a working model:

```ts
// src/app/users/models/user/user.model.ts (continued)
import { Model, RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
}
```

What each piece does:

- `@RegisterModel()` puts `User` into Cascade's global registry. That registry is what lets relations look each other up by name (`@BelongsTo("User")` or `@BelongsTo(lazy(() => User))`) — you set up for relations now even though you haven't written one yet.
- `extends Model<UserSchema>` gives the class the entire CRUD/query API typed against your schema. `User.create`, `User.find`, `User.where`, `User.first`, all of it — auto-completed against `UserSchema`.
- `static table = "users"` matches the migration. Plural, lowercase, snake_case is the convention on both drivers.
- `static schema = userSchema` attaches the validator. On every `save()`, the data goes through `userSchema` before it hits the database.

Stitched together, your `user.model.ts` now has everything Cascade needs.

## Step 3 — Save a record

In any service, controller, route handler, or script:

```ts
const user = await User.create({
  name: "Ada Lovelace",
  email: "ada@example.com",
});

console.log(user.id);              // the new ID Cascade assigned
console.log(user.get("status"));   // "active" — the schema default kicked in
```

What just happened:

- Cascade validated the input against `userSchema`, generated an `id`, persisted the row, and returned a hydrated `User` instance.
- `user.id` reads the ID via a built-in getter. `id` is so common Cascade exposes it as a direct property — no `.get(...)` needed.
- For every other column, use `user.get("field")`. That's the canonical reader for instance state across all your models.
- Schema defaults (like `status: "active"`) get applied during `create` — you don't need to pass them. Same goes for `.default(() => new Date())` for timestamps, computed defaults, etc.

## Step 4 — Query it back

The loop closes. Look up the record you just wrote:

```ts
const found = await User.find(user.id);
console.log(found?.get("email")); // "ada@example.com"
```

What just happened:

- `Model.find(id)` looks up a single record by ID and returns the instance — or `null` if no row exists, which is why we use `?.` to be safe.
- The model is the entry point. No `db.collection("users")`, no `prisma.user.findFirst()`, no repository to import. The class queries itself.
- For filtering, ordering, pagination, and the rest of the query vocabulary, see the [Querying essentials](../the-basics/02-querying.md) — that's `User.first({email: "ada@example.com"})`, `User.where(...)`, and friends.

## Recap

You have a working model. The four moves you just made are the four moves every Cascade model uses:

- **Schema** — `v.object` is your type, your validator, and your DB shape, all from one declaration
- **Class** — `@RegisterModel()` + `extends Model<Schema>` + `table` + `schema` = working model
- **Write** — `Model.create({...})` validates, persists, returns the hydrated instance. `.id` reads the new ID directly.
- **Read** — `Model.find(id)` reads by ID. The model is the query entry point.

## Next

Time to round out the write story.

Continue to **[CRUD basics](../the-basics/01-crud-basics.md)** for update, delete, and the other write patterns your everyday services will use. Then **[Querying](../the-basics/02-querying.md)** unpacks the model-as-query-builder we keep teasing.

If you'd rather skip ahead to relations (User has many Posts, Post belongs to User, the works), [Relationships](../the-basics/03-relationships.md) is waiting.
