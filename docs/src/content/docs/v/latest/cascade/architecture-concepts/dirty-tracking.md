---
title: "Dirty tracking"
sidebar:
  order: 2
  label: "Dirty tracking"
---

Every Cascade model carries a **dirty tracker** that records which fields you've changed since the model was loaded (or since the last `save()`). The tracker is what makes `model.save()` send only the changed columns to the database — not the entire document.

You don't have to interact with it explicitly. `set`, `merge`, `unset`, `increment`, and `decrement` all update the tracker for you. But there are moments when reading the dirty state directly is useful — conditional updates, audit logs, "only fire this event if the price actually changed."

## What counts as dirty

Anything that mutates `model.data` through the accessor API:

| Action                                | Dirty effect                          |
| ------------------------------------- | ------------------------------------- |
| `set("name", "Ada")`                  | `name` marked dirty with new value    |
| `merge({ name: "Ada" })`              | Each merged path marked dirty         |
| `unset("nickname")`                   | `nickname` marked **removed**         |
| `increment("loginCount")`             | `loginCount` marked dirty (new value) |
| `decrement(...)`                      | same                                  |
| Hydration after `find()` / `where()`  | **Clears** the tracker — model is fresh from DB |
| `save()`                              | **Clears** the tracker after success  |
| Reading via `get()`, `getString()`    | nothing                               |

Reads never mark anything. The model only knows about a change if it went through a write accessor.

## Reading the dirty state

```ts
user.merge({
  name: "Ada",
  email: "ada@example.com",
});

user.hasChanges();           // true
user.isDirty("name");        // true
user.isDirty("status");      // false

user.getDirtyColumns();
// → ["name", "email"]

user.getDirtyColumnsWithValues();
// → { name: { oldValue: "Charles", newValue: "Ada" },
//     email: { oldValue: "old@ex.com", newValue: "ada@example.com" } }

user.getRemovedColumns();
// → ["nickname"]  (only set by .unset())
```

Each method:

- **`hasChanges()`** — boolean. Anything dirty at all?
- **`isDirty(column)`** — was *this specific* column changed?
- **`getDirtyColumns()`** — array of changed column names.
- **`getDirtyColumnsWithValues()`** — same, but with `oldValue` / `newValue` pairs. Useful for audit logs.
- **`getRemovedColumns()`** — fields removed via `unset`.

## Common patterns

### Skip work when nothing changed

```ts
async function maybeSave(user: User) {
  if (!user.hasChanges()) return;
  await user.save();
}
```

`save()` will do nothing useful if there are no dirty fields, but the early return saves the round-trip *and* skips lifecycle events you don't need to fire.

### Fire an event only on a specific change

```ts
User.events().onSaving(async user => {
  if (user.isDirty("email") && !user.isNew) {
    // Email changed on an existing user — kick off re-verification
    await sendVerificationEmail(user.get("email"));
  }
});
```

Old/new values come from `getDirtyColumnsWithValues()` if you need both sides:

```ts
User.events().onSaving(async user => {
  const changes = user.getDirtyColumnsWithValues();
  if (changes.password) {
    await auditLog.record({
      event: "password_changed",
      userId: user.id,
      // never log the new password
    });
  }
});
```

### Audit log of every change

```ts
User.events().onUpdated(async (user, ctx) => {
  // After update — model's data is fresh, but the tracker has just been cleared.
  // Capture the dirty state BEFORE save by listening on `onSaving` instead:
});

User.events().onSaving(async (user, ctx) => {
  if (user.isNew) return; // skip inserts
  const changes = user.getDirtyColumnsWithValues();
  await AuditLog.create({
    table: "users",
    recordId: user.id,
    changes,
    changedAt: new Date(),
  });
});
```

The timing matters: `onSaving` fires *before* the database write, so the tracker still has the pre-save state. By `onSaved` / `onUpdated`, the tracker has been cleared.

### Conditional validation

```ts
User.events().onValidating(async user => {
  if (user.isDirty("password")) {
    // Re-hash only if the password actually changed
    user.set("password", await hash(user.get("password")));
  }
});
```

## What the tracker doesn't catch

A few edge cases where you'll see dirty state behave in ways that surprise the first time:

### Direct `model.data` mutation

```ts
user.data.name = "Ada"; // ❌ tracker doesn't know
```

Cascade tracks via the accessor methods, not via JavaScript property assignment. Always go through `set` / `merge` / etc. If you reach into `model.data` directly, dirty tracking has no idea anything happened — `save()` will think the model is unchanged and skip the column.

### Mutating arrays / objects in place

```ts
const tags = user.get("tags");
tags.push("typescript");      // ❌ tracker doesn't know
await user.save();            // tags column unchanged
```

Same problem at one level deeper. `user.get("tags")` returns the array by reference; mutating it doesn't go through `set`. To make this dirty:

```ts
const tags = user.get("tags") ?? [];
user.set("tags", [...tags, "typescript"]); // ✅
```

Or use the dirty-state-aware path:

```ts
user.set("tags.0", "typescript"); // ✅ also fine
```

### Setting a field to the same value

```ts
user.set("name", "Ada");   // user.get("name") was already "Ada"
user.isDirty("name");       // → true
```

Cascade marks the field as dirty regardless of whether the value actually changed. The dirty tracker tracks *attempts*, not *deltas*. If you need "did the value actually change?", compare manually:

```ts
const before = user.get("name");
user.set("name", newName);
const actuallyChanged = before !== newName;
```

For most apps this is a non-issue — `save()` is cheap, and the dirty tracker exists to *reduce* writes, not to perfectly detect deltas. But if you're paying for round-trips, the manual compare is the safe path.

## When the tracker resets

The dirty tracker clears in two places:

1. **After hydration** — when a model is loaded from the database (via `find`, `where`, `first`, eager-loading, etc.), the tracker starts empty. The hydrated model is "clean" — `hasChanges()` returns `false`.
2. **After a successful `save()`** — Cascade applies your changes, the DB confirms, and the tracker resets. Subsequent edits start a fresh dirty set.

That's it. There's no manual `clearDirty()` API — clearing is automatic on the two events that semantically mean "we're now in sync with the database."

## Going further

- **Lifecycle events** that read the dirty state (`onSaving`, `onUpdating`): [Events and hooks guide](./events-and-hooks.md)
- **The `save()` flow** and what dirty tracking sends to the driver: [CRUD basics](../the-basics/01-crud-basics.md)
- **Atomic database-side updates** (when you want a race-safe `UPDATE ... SET x = x + 1`): [Query Builder API reference](../reference/query-builder-api.md#incrementfield-amount--decrementfield-amount)
