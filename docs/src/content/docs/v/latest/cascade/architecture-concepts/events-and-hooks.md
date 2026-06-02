---
title: "Events and hooks"
sidebar:
  order: 3
  label: "Events and hooks"
---

Every meaningful moment in a model's lifecycle — about to validate, about to save, just saved, just deleted — fires an event. Subscribing to those events is how you wire cross-cutting behaviour onto a model without coupling it into every call site that touches the model.

Three scopes of subscription:

- **Instance** — listen on a single model instance. Rare in practice; useful for one-off transactions or tests.
- **Static** — listen on every instance of a model class (`User.events().onSaving(...)`). The common case.
- **Global** — listen on every model in the app (cross-cutting concerns like auditing). The rare-but-powerful case.

## The lifecycle events

Cascade emits these events, in this order, during the model's life:

| Event           | When                                                         | Use case                                |
| --------------- | ------------------------------------------------------------ | --------------------------------------- |
| `initializing`  | A model instance has just been constructed                   | Apply request-context defaults          |
| `fetching`      | Just before a query runs                                     | Modify the query builder mid-flight     |
| `hydrating`     | Raw rows fetched; about to become instances                  | Pre-hydration tweaks                    |
| `fetched`       | Models hydrated and ready                                    | Audit reads, attach derived data        |
| `validating`    | Save kicks off; about to validate against the schema         | Hash passwords, normalise input         |
| `validated`     | Validation succeeded                                         | Post-validate enrichment                |
| `saving`        | About to persist (both insert and update)                    | Stamp `updatedBy`, log change context   |
| `creating`      | About to insert a new row                                    | Generate slugs, assign defaults         |
| `created`       | Insert succeeded                                             | Fire welcome emails, seed related rows  |
| `updating`      | About to update an existing row                              | Diff against `getDirtyColumnsWithValues()` |
| `updated`       | Update succeeded                                             | Invalidate caches                       |
| `saved`         | Persist succeeded (insert or update)                         | Anything that doesn't care which        |
| `deleting`      | About to delete                                              | Cleanup linked resources                |
| `deleted`       | Delete succeeded                                             | Audit the deletion                      |
| `restoring`     | About to restore a soft-deleted / trashed model              | Rebuild derived state                   |
| `restored`      | Restore succeeded                                            | Notify subscribers                      |

Ordering for a typical save-insert: `validating` → `validated` → `saving` → `creating` → `created` → `saved`. For a save-update: `validating` → `validated` → `saving` → `updating` → `updated` → `saved`. For a delete: `deleting` → `deleted`.

## Static listeners — the everyday case

Most listeners live on the class, listening for *every* save / delete / etc. on that model:

```ts
User.events().onCreating(async user => {
  user.set("slug", slugify(user.get("name")));
});

User.events().onUpdated(async (user, ctx) => {
  await cache.invalidate(`user:${user.id}`);
});

User.events().onDeleting(async (user, ctx) => {
  console.log(`Deleting user ${user.id} via ${ctx.strategy}`);
});
```

The pattern: `Model.events().on<EventName>(listener)`. Each shortcut (`onSaving`, `onSaved`, `onCreating`, ...) typesthe `context` argument with the right shape for that event.

### Where to register

Static listeners are class-level — register them once at boot, in the same module as the model:

```ts
// src/app/users/models/user/user.model.ts

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
}

User.events().onCreating(async user => {
  user.set("slug", slugify(user.get("name")));
});

User.events().onDeleted(async (user, ctx) => {
  await audit("user.deleted", { id: ctx.primaryKeyValue, by: ctx.strategy });
});
```

### Unsubscribing

`on*` returns an unsubscribe function. Useful in tests and per-request listeners:

```ts
const off = User.events().onSaving(spy);
// ... do test stuff
off(); // remove the listener
```

For permanent app boot-up listeners, you usually don't need the return value.

## Listener signature

```ts
type Listener<TModel, TContext = unknown> = (
  model: TModel,
  context: TContext,
) => void | Promise<void>;
```

- **`model`** — the model instance being acted on. Type-safe for the class you registered against.
- **`context`** — event-specific metadata. Different events provide different shapes:
  - `validating` / `saving`: `{ isInsert: boolean; mode: "insert" | "update" }`
  - `deleting`: `{ strategy: "trash" | "permanent" | "soft"; primaryKeyValue; primaryKey }`
  - `deleted`: above + `{ deletedCount; trashRecord? }`
  - `fetching`: `{ table; modelClass }`
  - `hydrating`: `{ query; hydrateCallback? }`
  - `fetched`: `{ query; rawRecords; duration }`
  - Most others: `unknown` — feel free to pass your own context for custom event chains.

Listeners are awaited in registration order. Each can be async. If a listener throws inside a `*-ing` event (validating, saving, creating, etc.), the operation aborts — useful for "veto" hooks.

## Common patterns

### Stamp metadata before save

```ts
Post.events().onSaving(async post => {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (post.isNew) {
    updates.createdAt = new Date();
  }

  post.merge(updates);
});
```

Most apps stamp these in the schema/migration. But when the timestamp depends on request context (last-modifier user id, request id), saving them in `onSaving` keeps the model definition clean.

### Slug generation on insert only

```ts
Post.events().onCreating(async post => {
  if (!post.get("slug")) {
    post.set("slug", slugify(post.get("title")));
  }
});
```

`onCreating` only fires on inserts, so this can't accidentally re-slug on every update.

### Veto a save

```ts
Post.events().onSaving(async post => {
  if (post.isDirty("status") && post.get("status") === "published") {
    if (!post.get("body")) throw new Error("Cannot publish empty post");
  }
});
```

Throwing inside `*-ing` events aborts the operation and re-throws to the caller. Use sparingly — schema validation is usually the cleaner home for this kind of rule.

### Diff-aware update logging

```ts
User.events().onUpdating(async user => {
  const changes = user.getDirtyColumnsWithValues();
  if ("email" in changes) {
    await AuditLog.create({
      event: "user.email_changed",
      userId: user.id,
      from: changes.email.oldValue,
      to: changes.email.newValue,
    });
  }
});
```

See the [Dirty tracking guide](./dirty-tracking.md) for the full read-the-changes story.

### Cleanup linked rows on delete

```ts
Order.events().onDeleted(async (order, ctx) => {
  if (ctx.strategy === "permanent") {
    await OrderLine.where("orderId", order.id).delete();
  }
});
```

Conditional on the delete strategy — soft deletes shouldn't cascade, permanent deletes should. The `ctx.strategy` tells you which path ran.

## Instance listeners

Sometimes you want a listener that fires only for *this* instance, not every instance of the class:

```ts
const user = await User.find(123);

user.on("saved", async u => {
  console.log(`Just saved ${u.get("email")}`);
});

await user.save();
// → "Just saved ..."

await otherUser.save();
// → (no log — listener was instance-bound)
```

Use cases: per-request enrichment, test scaffolding, one-shot side effects you don't want to leak to other instances.

There's also `user.once(event, listener)` (fires once then auto-unsubscribes) and `user.off(event, listener)` (remove a specific listener).

## Global listeners

For cross-cutting concerns that apply to **every** model in the app — request-id stamping, full audit logging, telemetry — register on the global emitter:

```ts
import { globalModelEvents } from "@warlock.js/cascade";

globalModelEvents.on("saving", async (model, ctx) => {
  // Runs for every Model on every save
  if ("set" in model) {
    model.set("modifiedBy", currentUserId());
  }
});
```

Most apps don't need this. The static `Model.events()` listeners are usually clearer because they're co-located with the model and don't fire for unrelated tables. Reach for global only when the behaviour really does apply to *every* model.

## Skipping events

For administrative operations that shouldn't fire the full event chain, both writes and deletes accept `skipEvents`:

```ts
await user.save({ skipEvents: true });
await user.destroy({ skipEvents: true });
await User.restore(id, { skipEvents: true });
```

Useful for migrations, bulk seeders, and replaying state without re-triggering side effects. Use sparingly — by default, you want events to fire.

## Going further

- **Dirty state inside listeners** — [Dirty tracking guide](./dirty-tracking.md)
- **Lifecycle event during fetch** (`onFetching` / `onFetched`) and how they relate to query-builder lifecycle callbacks — [Query Builder API reference](../reference/query-builder-api.md#onfetchingcallback)
- **Delete-strategy-specific event context** — [Delete strategies guide](../digging-deeper/delete-strategies.md)
