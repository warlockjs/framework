---
name: subscribe-to-model-events
description: 'Hook into model lifecycle events — `saving` / `saved`, `creating` / `created`, `updating` / `updated`, `validating` / `validated`, `deleting` / `deleted`, `restoring` / `restored`, `fetching` / `fetched`. Per-model `Model.on(event, fn)` or global via `Model.globalEvents()`. Triggers: `Model.on`, `Model.off`, `saving`, `saved`, `created`, `updated`, `deleting`, `deleted`, `restored`; "audit log on save", "notify on change", "denormalize into search index"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: dirty tracking — `@warlock.js/cascade/track-changes/SKILL.md`; competing libs `mongoose` middleware, `typeorm` subscribers, `prisma` extensions.'
---

# Use model events

Every meaningful moment in a model's lifecycle — about to validate, about to save, just saved, just deleted — fires an event. Subscribe to hook in cross-cutting behavior without scattering it across every service.

## Subscribing — per-model

```ts
User.on("saved", async (user) => {
  await searchIndex.upsert({ id: user.id, name: user.get("name") });
});

User.on("deleted", async (user) => {
  await searchIndex.remove(user.id);
});
```

Listeners are async-aware — the model's persistence awaits the listener before moving on. A listener that throws during a pre-write event (`saving` / `creating` / `updating` / `validating`) aborts the operation; the error propagates to the caller.

## The full event catalog

The events fire in this order. The **gerund** form (`saving`, `creating`) is the "before" hook — there is no `beforeSave` alias.

| Event | Fires |
| --- | --- |
| `saving` | Before validation, on every `save()` (both insert and update paths) |
| `validating` / `validated` | Around schema validation |
| `creating` | Before a new record is inserted (first save) |
| `updating` | Before an existing record's update is written |
| `saved` | After a successful write (any branch — insert or update) |
| `created` | After a new record is inserted |
| `updated` | After an existing record's update is written |
| `deleting` / `deleted` | Before / after the delete strategy runs |
| `restoring` / `restored` | Before / after a soft-deleted or trashed record is restored |
| `fetching` / `fetched` / `hydrating` | Around reads / instance hydration |

`saving` fires for both inserts and updates; `creating` / `updating` narrow to the branch. So `saved` always fires; exactly one of `created` / `updated` follows.

## Listener signature

```ts
User.on("saving", async (user, context) => {
  // user:    the User instance about to be persisted
  // context: { isInsert, options, mode } for `saving`; varies per event
});
```

The first argument is the model instance. The second carries event context (for `saving`: whether it's an insert, the `save()` options, and the mode).

## Throwing to abort

A listener on a pre-write event that throws stops the lifecycle — the save / delete never completes and the error propagates:

```ts
User.on("saving", async (user) => {
  if (user.isDirty("email") && (await emailIsBlacklisted(user.get("email")))) {
    throw new Error("Email domain is blacklisted");
  }
});
```

Pair with `isDirty()` from [`@warlock.js/cascade/track-changes/SKILL.md`](@warlock.js/cascade/track-changes/SKILL.md) so the listener only runs its expensive check when the relevant field changed.

## Global listeners — across all models

For framework-level concerns (audit log, observability, cache invalidation), subscribe on the base `Model` — the listener runs for every model:

```ts
import { Model } from "@warlock.js/cascade";

Model.on("saved", async (instance) => {
  await audit.log("save", instance.constructor.name, instance.id, instance.getDirtyColumns());
});
```

Filter by `instance.constructor.name === "User"` when you only care about specific models, or register per-model handlers when the scope is narrow. (`Model.globalEvents()` returns the underlying global emitter if you need direct access.)

## `off()` to unsubscribe

```ts
const handler = async (user) => {
  /* ... */
};
const unsubscribe = User.on("saved", handler);

// later — either:
unsubscribe();
// or:
User.off("saved", handler);
```

`on()` also returns an unsubscribe function. Mostly useful in tests where you want to temporarily swap behavior.

## Common patterns

### Audit log (combined with dirty tracking)

```ts
Model.on("updated", async (instance) => {
  const changes = instance.getDirtyColumnsWithValues();
  if (Object.keys(changes).length === 0) {
    return;
  }

  await AuditLog.create({
    model: instance.constructor.name,
    record_id: instance.id,
    changes,
    saved_at: new Date(),
  });
});
```

Use `updated` (not `saved`) when you only want change diffs — `getDirtyColumnsWithValues()` is still populated in the post-write events because the tracker resets *after* they fire.

### Cache invalidation

```ts
User.on("saved", async (user) => {
  await cache.tags([`user.${user.id}`]).invalidate();
});

User.on("deleted", async (user) => {
  await cache.tags([`user.${user.id}`]).invalidate();
});
```

See [`@warlock.js/cache/use-cache-tags/SKILL.md`](@warlock.js/cache/use-cache-tags/SKILL.md).

### Side effects that must only fire after commit

For external side effects (queues, emails) that must only fire if a surrounding transaction commits, don't run them in the `saved` handler — write to an outbox table and dispatch from a worker after commit.

## Things NOT to do

- Don't reach for `beforeSave` / `destroying` / `destroyed` — they don't exist. The hooks are `saving` (pre-save) and `deleting` / `deleted`.
- Don't run long external work (HTTP calls, queue dispatches) directly in `saving` / `saved` handlers — inside a transaction they extend the lock. Use an outbox table.
- Don't mutate the model's own fields in `saved` and expect them to persist. The write already happened; mutations here are in-memory only. Use `saving` for pre-persist mutation.
- Don't subscribe inside a function that runs on every request. Register handlers once at startup, in a dedicated init file.

## See also

- [`@warlock.js/cascade/track-changes/SKILL.md`](@warlock.js/cascade/track-changes/SKILL.md) — `isDirty` / `getDirtyColumnsWithValues` for "only run if this field changed"
- [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md) — `deleting` / `deleted` / `restored` around delete strategies
