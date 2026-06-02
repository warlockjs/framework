---
name: track-changes
description: 'Inspect a model''s pending changes — `hasChanges()` (any field dirty?), `isDirty(column)` (one column), `getDirtyColumns()` (changed field names), `getDirtyColumnsWithValues()` (old + new per field), `getRemovedColumns()` (unset fields). Triggers: `hasChanges`, `isDirty`, `getDirtyColumns`, `getDirtyColumnsWithValues`, `getRemovedColumns`; "only run if email changed", "diff for an audit log", "what fields are dirty", "compare old vs new value"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: hooking into save — `@warlock.js/cascade/subscribe-to-model-events/SKILL.md`; update idioms — `@warlock.js/cascade/define-model/SKILL.md`; competing libs `mongoose` `isModified` / `modifiedPaths`, `typeorm` change detection.'
---

# Track changes

Every Cascade model carries a dirty tracker that records which fields you've changed since the model was loaded (or since the last `save()`). The tracker is the source of truth for "what would change if I save now."

## The main reads

```ts
user.hasChanges();           // boolean — any field changed (or removed)?
user.isDirty("email");       // boolean — specifically this column?

user.getDirtyColumns();      // string[] — names of changed columns
user.getRemovedColumns();    // string[] — columns explicitly unset since load

user.getDirtyColumnsWithValues();
// Record<string, { oldValue, newValue }> — the full diff, old + new per column
```

`isDirty` takes **one** column. To check several, ask `getDirtyColumns()` once and test membership (see the multi-field section below).

## Conditional logic before save

```ts
if (user.isDirty("email")) {
  const { oldValue } = user.getDirtyColumnsWithValues().email;
  await mailer.sendEmailChangeNotice(oldValue);
}

await user.save();
```

The classic shape — only fire the side effect if the field actually changed. The pre-mutation value comes from `getDirtyColumnsWithValues()[column].oldValue`.

## Diff for an audit log

```ts
const changes = user.getDirtyColumnsWithValues();
// e.g. { name: { oldValue: "Ada", newValue: "Augusta Ada King" } }

await AuditLog.create({
  user_id: user.id,
  before: Object.fromEntries(
    Object.entries(changes).map(([field, { oldValue }]) => [field, oldValue]),
  ),
  after: Object.fromEntries(
    Object.entries(changes).map(([field, { newValue }]) => [field, newValue]),
  ),
  changed_at: new Date(),
});
```

`getDirtyColumnsWithValues()` hands you old and new together, so you never need a second call to read the prior value.

## After save — tracker resets

```ts
user.set("name", "Augusta");
user.isDirty("name");        // true
await user.save();
user.isDirty("name");        // false — tracker reset to the just-saved state
```

`save()` resets the tracker's baseline to the persisted state. Subsequent `isDirty()` checks measure changes since the last `save()`, not since the original load.

## Multi-field check

`isDirty` is single-column. For "did any of these change?", read the dirty set once:

```ts
const dirty = new Set(user.getDirtyColumns());
const billingTouched = ["billing_address", "billing_city", "billing_zip"].some((field) =>
  dirty.has(field),
);

if (billingTouched) {
  await revalidateBillingAddress(user);
}
```

## Tracker vs `.get()`

- `user.get("email")` — the **current** value (post-mutation if you called `.set` / `.merge`)
- `user.getDirtyColumnsWithValues().email?.oldValue` — the **pre-mutation** value (whatever the DB had)
- `user.getDirtyColumns()` — the **changed field names** (string array)
- `user.getDirtyColumnsWithValues()` — the **full diff** (old + new per changed field)

If you need both old and new together:

```ts
const dirty = user.getDirtyColumnsWithValues();
for (const [field, { oldValue, newValue }] of Object.entries(dirty)) {
  // ... log, validate, conditionally re-route
}
```

## Things NOT to do

- Don't use `hasChanges()` / `isDirty()` after `save()` to verify the save persisted. The tracker resets to clean on save — these become false regardless. Read back from the DB if you need verification.
- Don't compare `user.get(field) === oldValue` for change detection — call `isDirty(field)` instead. The tracker uses identity-aware comparison appropriate to the column type (deep-equal for objects/arrays).
- Don't expect dirty tracking on relations. The tracker covers columns only. For relation changes, use lifecycle events or compare counts.

## See also

- [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md) — combining with `saved` / `saving` for cross-cutting behavior
- [`@warlock.js/cascade/define-model/SKILL.md`](@warlock.js/cascade/define-model/SKILL.md) — the `.set` / `.merge` / `.save` idioms that stage changes
