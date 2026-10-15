---
title: "Sync — keeping embedded data fresh"
sidebar:
  order: 11
  label: "Sync (embedded data)"
---

When you denormalise data — embed the user's name into every comment, embed the category into every product — you trade query simplicity for write complexity. Update the source row and now the embedded copies are stale.

Cascade's **sync system** automates the propagation: register *"when `Category` updates, refresh `Product.category` to match"*, and Cascade wires up the events for you. No manual `Product.where("category.id", id).update(...)` calls scattered through your update services.

This guide walks the API: when to reach for sync, how to declare it, and the depth/cycle/cleanup safety rails.

## When to reach for sync

Sync exists for **denormalised reads** — the pattern where you embed a snapshot of one model inside another for query speed, and now you have two copies that must agree.

Common shapes:

- **Comment includes author snapshot** (`comment.author = { id, name, avatar }`) so the comment list doesn't N+1 the users table.
- **Product includes category snapshot** (`product.category = { id, name, slug }`) so the product listing doesn't join.
- **Post includes tags array** (`post.tags = [{ id, name }, { id, name }]`) so the tag pills render without a separate query.

If you'd rather load relations on demand (`.with("author")`), you don't need sync — `.with()` always reads the live row. Sync is for the cases where you've chosen to denormalise the snapshot into the document itself.

## The minimal example

```ts
// src/app/blog/events/sync.ts
import { modelSync } from "@warlock.js/cascade";
import { Category, Product } from "../models";

export const cleanup = modelSync.register(() => {
  Category.sync(Product, "category").embed("embedMinimal");
});
```

What this does:

- **Listens** to `Category.saved` events.
- When fired, **updates every `Product`** whose embedded `category.id` matches the saved category's id.
- The new embedded value comes from calling `category.embedMinimal()` on the source — you control what gets embedded.

That's it. One line. Cascade handles the event subscription, the bulk update, the depth limiting, the cycle detection.

The exported `cleanup` function is the HMR (hot-module-reload) escape hatch — call it when the module reloads to remove the registered listeners so they don't pile up.

## Where to put the registration

Sync registrations don't belong on the model file — they're cross-cutting. The convention is a per-feature `events/sync.ts` (or similar) that runs once at boot. Export `cleanup` for the HMR case:

```ts
// src/app/blog/events/sync.ts — runs once at boot
import { modelSync } from "@warlock.js/cascade";
import { Category, Product, Tag, Post } from "../models";
import { User } from "app/users/models/user/user.model";

export const cleanup = modelSync.register(() => {
  // Single embedded category on each product
  Category.sync(Product, "category").embed("embedMinimal");

  // Array of embedded tags on each post
  Tag.syncMany(Post, "tags").identifyBy("id");

  // Author snapshot on every comment
  User.sync(Comment, "author").watchFields(["name", "avatar"]);
});
```

Most apps import this file from their app bootstrap so the listeners register exactly once.

:::note — `Model.sync()` is not pivot sync

`Model.sync(Target, field)` on this page is the **denormalization-embed** feature — refresh embedded copies when the source changes. It is unrelated to `model.pivot(relation).sync(ids)`, which replaces the set of rows in a `@BelongsToMany` pivot table (see [Relationships](./relationships.md#pivot-operations--modelpivotrelation)). Different feature, different shape — the `.pivot(...)` qualifier keeps them from colliding.

:::

## `Model.sync(Target, field)` — single embedded document

```ts
Category.sync(Product, "category").embed("embedMinimal");
```

- **`Model`** — the source. Updates to instances of `Model` trigger the sync.
- **`Target`** — the model that holds the embedded copy.
- **`field`** — the field on `Target` where the embedded copy lives.
- **`.embed(methodName)`** — which method to call on the source to produce the embedded snapshot. Defaults to `"embedData"`; conventionally `"embedMinimal"` for lighter snapshots.

When `category.save()` runs, Cascade calls `category.embedMinimal()` and writes the result into every matching `Product.category`.

### Defining the embed methods

You add the methods to the source model:

```ts
class Category extends Model<CategorySchema> {
  // Standard embed — used when `.embed()` isn't called explicitly
  public embedData() {
    return {
      id: this.id,
      name: this.get("name"),
      slug: this.get("slug"),
      description: this.get("description"),
    };
  }

  // Lighter snapshot — used when `.embed("embedMinimal")` is set
  public embedMinimal() {
    return {
      id: this.id,
      name: this.get("name"),
    };
  }
}
```

You can define as many embed methods as you like (`embedListView`, `embedDetailView`, ...) and pick the right one per sync registration. The method's return value is what lands in the target field.

## `Model.syncMany(Target, field)` — array of embedded documents

For one-to-many denormalisation — every post embeds an array of its tags, every order embeds its line items:

```ts
Tag.syncMany(Post, "tags").identifyBy("id");
```

- **`.identifyBy(fieldName)`** is **required** for `syncMany` — it tells Cascade which field inside the array entries identifies the position to update. Without it, Cascade can't know which tag in `post.tags` should be refreshed.

When `tag.save()` runs, Cascade updates every `Post` where some entry in `post.tags` has `id === tag.id`. The matching entry is replaced with the new embed; siblings are left alone.

## Filtering — `.watchFields([...])`

By default, every save on the source fires the sync. For hot writes (a user's `lastSeenAt` updated on every request), that's noisy. Limit syncing to when *specific* fields change:

```ts
User.sync(Comment, "author").watchFields(["name", "avatar"]);
```

If only `lastSeenAt` is dirty, the sync is skipped. If `name` or `avatar` is dirty, it runs. Smaller writes mean cheaper denormalisation.

## Deletion semantics — `.unsetOnDelete()` / `.removeOnDelete()`

What happens to the embedded copy when the *source* row is deleted? Two strategies, both opt-in:

```ts
// Clear the embedded field (set to null)
Category.sync(Product, "category").unsetOnDelete();

// Delete the target row entirely
User.sync(Profile, "user").removeOnDelete();
```

Without either, the embed sits stale referencing a now-gone source — the deletion event doesn't fan out. Pick the strategy that matches your invariant.

For `syncMany`, deletion removes the matching entry from the array — same idea, different mechanics.

## Depth limiting — `.maxDepth(n)`

Sync chains. `Category → Product → Module` — updating a category triggers a product update, which triggers a module update. Three hops, three writes. Without a ceiling, a long denormalised chain (or worse, a cycle) can run away:

```ts
Category.sync(Product, "category").maxDepth(2);
```

Default cap is **3 levels**. Cycles are detected and broken regardless of the cap — but `maxDepth` is the additional safety against just-deep-enough non-cyclic chains. Set it conservatively; only raise when you've measured the chain and confirmed each hop is intentional.

## What happens on save

The event flow when something syncs:

```
Model.save()
   ↓ DatabaseWriter emits model.{ModelName}.updated
   ↓ ModelSyncOperation receives the event
   ↓ SyncManager batches updates by depth and table
   ↓ Driver runs the bulk updateMany
```

A few practical consequences:

- **Sync runs after the source save commits.** It's not part of the source transaction.
- **The bulk update doesn't fire target-model lifecycle events.** `Product`'s `onUpdating`/`onUpdated` don't run for sync-driven updates — they're driver-level bulk writes.
- **Sync is non-atomic across collections.** A sync that updates `Product` and `Module` is two separate driver operations. If you need cross-collection atomicity, wrap the source save and the sync in a transaction — but note that the sync's bulk updates happen *after* the source save commits, so a transaction wrapping just the source save won't roll back the sync.

If you need synchronous atomicity, the pattern is "drive the multi-row update yourself inside a transaction" rather than relying on the sync system.

## Patterns

### Lightweight author snapshot

```ts
// Comment shows author's name + avatar inline
User.sync(Comment, "author")
  .embed("embedMinimal")
  .watchFields(["name", "avatar"])
  .unsetOnDelete();
```

Only re-syncs when name/avatar changes. On user delete, clears the embedded author so deleted-user comments don't reference a phantom user.

### Multi-level chain

```ts
modelSync.register(() => {
  // Category → Product.category
  Category.sync(Product, "category").maxDepth(2);

  // Product → Module.products[]
  Product.syncMany(Module, "products").identifyBy("id");
});
```

Updating a `Category`:

1. **Depth 1** — refreshes every `Product.category`.
2. **Depth 2** — that triggers `Product.saved`, which refreshes the matching entry in every `Module.products[]`.
3. **Depth 3** — blocked by the `maxDepth(2)` on the Category sync.

### HMR-safe registration

```ts
// Once at boot
const cleanup = modelSync.register(() => {
  Category.sync(Product, "category");
});

// On HMR reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => cleanup());
}
```

The cleanup function removes the registered listeners. Without it, every HMR reload would *add* another set of subscribers on top of the existing ones, eventually firing the sync N times per save.

## When *not* to use sync

Sync is for denormalised snapshots. Reach for `.with()` / `.joinWith()` (live relations) when:

- **The embedded data is large** — embedding a User into every Comment with full profile is wasteful; loading the user once via `.with("author")` is cheaper than copying.
- **Updates are frequent** — if `User.name` changes 100x/sec, syncing every Comment on every change is more expensive than joining at read time.
- **Read traffic is low** — denormalisation is a *read* optimisation. If reads are rare, join at read time and skip the write amplification.

The rule of thumb: denormalise (and sync) when reads dwarf writes and embedded data is small. Otherwise, keep it normalised and load relations on demand.

## Going further

- **`with()` / `joinWith()`** — the live-relation alternative: [Relationships essentials](../the-basics/03-relationships.md), [Joins guide](./joins.md)
- **Embedded model validators** (`v.embed()`) for the storage shape: [Validation guide](../the-basics/validation.md)
- **Transactions** for cross-collection atomicity: [Transactions guide](./transactions.md)
- **Lifecycle events** that fire on the source (and don't fire on the target during sync): [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
