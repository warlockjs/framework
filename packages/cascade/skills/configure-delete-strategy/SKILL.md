---
name: configure-delete-strategy
description: 'Pick the delete behavior — `permanent` (hard delete), `soft` (set `deletedAt`, keep the row), `trash` (move to a separate table). Configure via `static deleteStrategy` or `.destroy({ strategy })`; restore via static `Model.restore(id)` / `Model.restoreAll()`. Triggers: `static deleteStrategy`, `.destroy`, `Model.restore`, `Model.restoreAll`, `deletedAtColumn`, `trashTable`; "soft delete users", "restore a deleted record", "GDPR hard delete"; typical import `import { Model } from "@warlock.js/cascade"`. Skip: lifecycle events — `@warlock.js/cascade/subscribe-to-model-events/SKILL.md`; competing libs `mongoose-delete`, `typeorm softRemove`, `sequelize` paranoid.'
---

# Use delete strategies

`destroy()` does more than `DELETE FROM table`. Cascade supports three strategies that change what happens to the record. Your data source's `defaultDeleteStrategy` applies unless you override per-model or per-call; with nothing configured the fallback is `permanent`.

## The three strategies

`DeleteStrategy` is `"permanent" | "soft" | "trash"`.

| Strategy | Behavior | Reversible? |
| --- | --- | --- |
| `permanent` | DELETE the row / document (the default fallback) | No |
| `soft` | Set the `deletedAt` column; the row stays in the table | Yes — via `Model.restore(id)` |
| `trash` | Move the record to a separate table / collection, then delete the original | Yes — via `Model.restore(id)` |

## Set the default per-model

```ts
import { Model, RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static deleteStrategy = "soft" as const; // every destroy() is soft unless overridden
  public static deletedAtColumn = "deletedAt"; // default; set false to disable the column
}
```

When the strategy resolves to `"soft"`, `Migration.create(Model, { … })` adds the `deletedAt` column for you (using `deletedAtColumn`), so the schema matches what `destroy()` writes — no need to declare it in the migration. Opt out per table with `{ softDeletes: false }`. See [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md).

## Override per-call

```ts
await user.destroy();                            // uses the model's strategy
await user.destroy({ strategy: "permanent" });   // GDPR-compliant hard delete
await user.destroy({ strategy: "trash" });       // move to the trash table
```

Resolution order: `destroy({ strategy })` → `static deleteStrategy` → data source `defaultDeleteStrategy` → `"permanent"`.

After a `"soft"` destroy the in-memory instance reflects the change — `model.get(deletedAtColumn)` returns the persisted timestamp (the row stays, so the instance stays usable).

## Restoring — static, by id

Restore is a **static** operation keyed by the record's id. It auto-detects whether the record was soft-deleted or trashed:

```ts
const user = await User.restore(123);            // clears deletedAt or pulls from trash; fires "restored"
const user2 = await User.restore(123, { onIdConflict: "fail" });

await User.restoreAll();                          // restore every deleted record for this model
```

There is no instance `user.restore()` — call `User.restore(id)`. `restoreAll(options?)` restores all soft-deleted (or all trashed) records for the model's table.

## Trash strategy — a separate store

```ts
await user.destroy({ strategy: "trash" }); // moved to the model's trash table, original deleted

await User.restore(user.id); // pull back out of the trash table
```

The trash table name resolves as: `static trashTable` on the model → data source `defaultTrashTable` → the `{table}Trash` pattern (e.g. `usersTrash`). Useful when soft-delete clutter would bloat the main table.

## Querying soft-deleted records — you filter, Cascade doesn't

**Important:** Cascade does **not** auto-hide soft-deleted rows. A plain `User.all()` returns deleted rows too, because the query builder has no built-in `deletedAt` filter. If you want the common "active records only" default, register a global scope yourself:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static deleteStrategy = "soft" as const;

  static {
    // hide soft-deleted rows from every query by default
    this.addGlobalScope("notDeleted", (query) => {
      query.whereNull("deletedAt");
    });
  }
}
```

With that scope in place:

```ts
await User.all();                                          // active only (scope applied)
await User.query().withoutGlobalScope("notDeleted").get(); // active + soft-deleted
await User.query().withoutGlobalScope("notDeleted").whereNotNull("deletedAt").get(); // only deleted
```

`withoutGlobalScope("notDeleted")` bypasses the filter for one query; `withoutGlobalScopes()` drops all of them. See [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) for scopes.

## Lifecycle hooks fire on all strategies

The delete events are `deleting` / `deleted` (not `destroying` / `destroyed`):

```ts
User.on("deleting", async (user) => {
  /* about to delete, any strategy */
});
User.on("deleted", async (user) => {
  /* delete completed; context carries the strategy + trashRecord for trash */
});
User.on("restored", async (user) => {
  /* soft-delete or trash restoration completed */
});
```

See [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md).

## Things NOT to do

- Don't switch a model to `soft` without a migration adding the `deletedAt` column. The strategy writes to it.
- Don't assume soft-deleted rows are hidden automatically — they're not. Add a `notDeleted` global scope (above) or filter `whereNull("deletedAt")` explicitly.
- Don't call `user.restore()` — restore is static: `User.restore(id)` / `User.restoreAll()`.
- Don't expect `restore` to undo a `permanent` delete. Hard deletes are gone.
- Don't use soft delete for GDPR right-to-be-forgotten data. The record stays in the DB; you need `permanent` (plus backup cleanup).

## See also

- [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md) — `deleting` / `deleted` / `restored` events
- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — global scopes and `withoutGlobalScope` for surfacing deleted rows
