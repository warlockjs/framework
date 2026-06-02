---
name: perform-atomic-ops
description: 'Avoid races on concurrent writes — `Model.increase(filter, field, n)` / `Model.decrease` for atomic counters, `Model.atomic(filter, ops)` for arbitrary mutations (`$set` / `$inc` / `$push` / `$pull`), `Model.createMany` / `Model.findAndUpdate` / `Model.delete` for bulk. Triggers: `Model.increase`, `Model.decrease`, `Model.atomic`, `Model.createMany`, `Model.findAndUpdate`, `Model.delete`, `$inc`, `$set`; "increment counter under concurrency", "bulk insert without N+1", "atomic update without loading"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: multi-row atomicity — `@warlock.js/cascade/manage-transactions/SKILL.md`; competing patterns `mongoose findOneAndUpdate`, `pg` `UPDATE ... SET x = x + 1`.'
---

# Use atomic operations

When two requests want to change the same row at the same time, you need atomicity — a guarantee that one operation completes before the other reads. For multi-document atomicity use transactions; for single-document atomic mutations these are the right tools.

## Counters — `Model.increase` / `Model.decrease`

```ts
await Post.increase({ id: postId }, "views", 1);
await Product.decrease({ id: productId }, "inventory", 1);
```

Signature: `Model.increase(filter, field, amount)` / `Model.decrease(filter, field, amount)` → `Promise<number>` (matched count). Atomic at the storage layer — no read-modify-write race even under high concurrency.

## Arbitrary atomic mutations — `Model.atomic`

```ts
await User.atomic({ id: userId }, {
  $set: { last_seen: new Date() },
  $inc: { login_count: 1 },
});
```

`Model.atomic(filter, operations)` → `Promise<number>`. Driver-flavored atomic mutation — MongoDB has `$set` / `$inc` / `$push` / `$pull`; the Postgres driver translates the equivalents. Use when you need to combine multiple field changes atomically without loading the model first.

## Bulk insert — `Model.createMany`

```ts
const created = await OrderItem.createMany([
  { order_id, product_id: 1, quantity: 2 },
  { order_id, product_id: 2, quantity: 1 },
  { order_id, product_id: 3, quantity: 5 },
]);
// created: OrderItem[]
```

`Model.createMany(rows)` → `Promise<TModel[]>`. Validation runs per row; wrap in a transaction if you need strict all-or-nothing semantics.

## Bulk update — `Model.findAndUpdate(filter, operations)`

```ts
const updated = await User.findAndUpdate(
  { status: "pending" },
  { $set: { status: "active" } },
);
// updated: User[] — the matched-and-updated models
```

`Model.findAndUpdate(filter, operations)` takes **update operators** (`$set` / `$inc` / `$unset`), not a plain data object, and returns the updated models. For a single record there's `Model.findOneAndUpdate(filter, operations)` → `TModel | null`, and to update strictly by id, `Model.update(id, data)` → `Promise<number>`.

**Important.** Per-instance lifecycle `saved` events do NOT fire for each row on `findAndUpdate`. If you need `saved` per row, iterate with `.get()` and `.save()` instead — slower but event-correct.

## Bulk delete — `Model.delete(filter)`

```ts
await User.delete({ status: "spam" });      // delete all matching → count
await User.deleteOne({ status: "spam" });   // delete the first match → count
```

`Model.delete(filter?)` and `Model.deleteOne(filter?)` both return `Promise<number>`. These bypass the per-instance delete strategy and `deleted` events — they are raw driver deletes.

For per-row event-aware (and delete-strategy-aware) bulk delete, iterate:

```ts
const targets = await User.where("status", "spam").get();
for (const user of targets) {
  await user.destroy();
}
```

## When to reach for what

| Task | Reach for |
| --- | --- |
| Increment a counter | `Model.increase(filter, field, n)` |
| Atomically change multiple fields on one record | `Model.atomic(filter, ops)` |
| Insert N records | `Model.createMany(rows)` |
| Update many rows with operators | `Model.findAndUpdate(filter, { $set: {...} })` |
| Update one record by id | `Model.update(id, data)` |
| Delete many rows (raw) | `Model.delete(filter)` |
| Multi-row read-modify-write | Wrap in a [transaction](@warlock.js/cascade/manage-transactions/SKILL.md) |
| Need lifecycle events / delete strategy per row | `Model.where(...).get()` + iterate + `.save()` / `.destroy()` |

## Things NOT to do

- Don't `const post = await Post.find(id); post.set("views", post.get<number>("views") + 1); await post.save();` for a counter. That's a lost-update race under concurrency. Use `Post.increase(filter, "views", 1)`.
- Don't reach for `insertMany` / `updateMany` / `deleteMany` — those names don't exist on the model. Use `createMany` / `findAndUpdate` / `delete`.
- Don't expect `findAndUpdate` / `delete` to fire per-row `saved` / `deleted` events or honor the delete strategy. They don't. Iterate if you need that.
- Don't bulk-insert a million rows in one `createMany` call — chunk it. Most drivers cap effectively at a few thousand per round-trip.

## See also

- [`@warlock.js/cascade/manage-transactions/SKILL.md`](@warlock.js/cascade/manage-transactions/SKILL.md) — multi-row atomicity
- [`@warlock.js/cascade/paginate-results/SKILL.md`](@warlock.js/cascade/paginate-results/SKILL.md) — `.chunk` for bulk-processing iteration
