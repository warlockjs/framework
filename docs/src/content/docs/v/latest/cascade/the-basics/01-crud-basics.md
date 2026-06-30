---
title: "CRUD basics"
sidebar:
  order: 1
  label: "CRUD basics"
---

You already created Ada and looked her up by ID. Now let's change her, remove a field, and eventually delete the record entirely. Cascade gives you three update idioms — each useful in different situations — and one universal delete call. By the end of this page, the full single-record write story is yours.

## Prerequisites

- A working model and at least one record in your database (from [Your first model](../getting-started/05-your-first-model.md))

## Where we left off

You wrote:

```ts
const user = await User.create({ name: "Ada Lovelace", email: "ada@example.com" });
```

And then read her back:

```ts
const found = await User.find(user.id);
```

The `user` instance is hydrated state — every column accessible via `user.get("field")`, plus `.id` directly. Everything below operates on that instance.

## Update — three idioms

Cascade gives you three ways to update an instance, and the codebase will use all three depending on context. Knowing when each fits saves you from reaching for the wrong one.

### `.set(field, value).save()` — one field change

The most direct shape — reads top to bottom like a sentence:

```ts
await user.set("status", "inactive").save();
```

`.set()` stages the change on the instance (not yet persisted), `.save()` writes pending changes to the DB and fires the relevant lifecycle events.

Once you're changing two or more fields, prefer `.merge()` — it takes an object and updates every key in one call, which reads cleaner than chained `.set()` calls.

### `.merge(data).save()` — bulk update from an object

This is the everyday case. You have an object of changes — usually from a service taking a `Partial<UserSchema>` argument from a request body — and you want every key in that object applied:

```ts
await user.merge({ name: "Augusta Ada King", status: "active" }).save();
```

`.merge()` copies each key from the object into the instance's pending state (only the keys present), then `.save()` persists. Existing fields not in the object are untouched. A typical update service in your codebase looks exactly like that one line.

### `.save()` after manual mutation — when you've already changed state

Sometimes the mutations are spread across branches and an object form would be awkward. `.save()` with no args flushes whatever's pending:

```ts
user.set("status", "inactive");

if (someCondition) {
  user.set("online_state", "offline");
}

// ... more logic ...

await user.save();
```

When a branch needs to update more than one field, reach for `.merge()` inside the branch — same rule as above.

:::caution — Don't forget the `await`

Without `await user.save()`, your changes live only on the instance and never reach the database. You'll see updated values in memory and stale values in the DB — and the gap will take longer to find than you'd think.

:::

### Quick reference

| Situation | Pattern | Notes |
| --------- | ------- | ----- |
| 1–2 specific fields | `user.set(k, v).save()` | Reads like a sentence |
| Bulk from an object | `user.merge(data).save()` | The update-service idiom |
| After spread mutations | `user.save()` | Easy to forget the await |

## Remove a field — `.unset()`

Sometimes you want a field *gone* — not set to `null` or `""`, but actually removed from the record. That's `.unset()`:

```ts
await user.unset("image").save();
```

`.unset()` marks the field for removal on the next save. On Postgres, the column gets set to `NULL`. On MongoDB, the field is dropped from the document entirely.

The reason this is its own idiom: "I have no image" and "image field is the empty string" mean different things. `.unset()` says "treat this field as if it was never there"; `.set("image", null)` would store an explicit null (and may fail validation if the field isn't `.optional()`). Use `unset` when you mean *gone*, not *blank*.

## Delete — `.destroy()`

When you're done with a record entirely:

```ts
await user.destroy();
```

`.destroy()` runs your model's lifecycle (events, configured delete strategy), then removes the record. The result is a structured object you can inspect if you need to know what happened — and like every other write call, don't forget the `await`.

:::tip — Delete strategies

`destroy()` does more than just "DELETE FROM table." Cascade supports multiple delete strategies — permanent (hard delete), soft (set a `deletedAt` timestamp and keep the row queryable as deleted), trash (move to a separate collection and keep it for later restore), or custom — that change what happens to the record. Your data source's default applies unless you pass `destroy({ strategy: "..." })`. The full picture (including restore) lives in the [Delete strategies guide](../digging-deeper/delete-strategies.md).

:::

## Recap

- **Update one or two fields:** `user.set(k, v).save()`
- **Update from a payload object:** `user.merge(data).save()` — the everyday case
- **Update after spread mutations:** `user.save()` (don't forget the `await`)
- **Remove a field entirely:** `user.unset(field).save()`
- **Delete a record:** `await user.destroy()`

## Next

Continue to **[Querying](./02-querying.md)** for the read story — filtering, ordering, pagination, eager loading, and the model-as-query-builder API you've been teased about since the intro.

## Going further

- **Soft vs hard vs trash delete, plus restore:** [Delete strategies guide](../digging-deeper/delete-strategies.md)
- **Lifecycle hooks** (`beforeSave`, `afterDestroy`, etc.): [Events & hooks guide](../architecture-concepts/events-and-hooks.md)
- **Bulk inserts** — `Model.createMany(rows, options?)` with chunking and a native multi-row `bulk` path: [Bulk inserts guide](../digging-deeper/bulk-inserts.md)
- **Bulk updates and deletes** — `Model.delete(filter)` and query-builder mass mutations
- **Dirty tracking** — knowing which fields changed before save: [Dirty tracking guide](../architecture-concepts/dirty-tracking.md)
