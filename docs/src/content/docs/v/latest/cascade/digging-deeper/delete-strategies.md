---
title: "Delete strategies"
sidebar:
  order: 4
  label: "Delete strategies"
---

Calling `user.destroy()` does one of three things, depending on your model's configuration:

- **`permanent`** — row is gone. The default. SQL `DELETE`, Mongo `deleteOne`.
- **`soft`** — row stays, a timestamp is written to a `deletedAt`-style column. The model can later be restored.
- **`trash`** — row is moved to a separate *trash* table/collection, then deleted from the original. Can be restored.

Cascade resolves the strategy at call time from a clear precedence chain. This guide explains each strategy, how to pick one per model, how restoration works, and the design tradeoffs you should weigh before committing.

## Strategy resolution

When `destroy()` runs, Cascade picks a strategy in this order (first one wins):

1. **`options.strategy`** — passed explicitly: `await user.destroy({ strategy: "soft" })`
2. **`Model.deleteStrategy`** — the static on the model class
3. **The data source's `defaultDeleteStrategy`** — set on the connection config
4. **`"permanent"`** — the fallback if nothing else is set

Most apps set this once per model (or once globally via the data source) and forget it.

## `permanent` — the default

```ts
@RegisterModel()
export class Log extends Model<LogSchema> {
  public static table = "logs";
  public static schema = logSchema;
  // No deleteStrategy set → permanent
}

await log.destroy(); // row is gone
```

The simplest, the cheapest, the most irreversible. Reach for it when:

- The row has no value once it's been deleted (audit logs you've already shipped to long-term storage, ephemeral session data, expired tokens).
- You have backups for "oops, didn't mean to delete that."
- Soft-delete state would pollute queries you don't want to think about.

After a permanent delete, the model instance is marked as *new* (no primary key), so calling `.save()` on it again would insert a brand new row.

## `soft` — keep the row, mark a timestamp

```ts
@RegisterModel()
export class Post extends Model<PostSchema> {
  public static table = "posts";
  public static schema = postSchema;
  public static deleteStrategy = "soft";
  public static deletedAtColumn = "deletedAt"; // default
}

await post.destroy();
// → UPDATE posts SET deletedAt = NOW() WHERE id = ?
```

How it works:

- Cascade writes the current time to the `deletedAtColumn` (default `"deletedAt"`). The row stays in the table.
- The in-memory instance is updated too — after `await model.destroy()`, `model.get("deletedAt")` returns the timestamp that was persisted.
- The model instance is **not** marked as new — its primary key is still valid, and a `restore()` call later can clear the timestamp.
- If `deletedAtColumn` is `false` or unset on a model configured for soft delete, `.destroy()` throws — soft delete needs somewhere to store the timestamp.

Override the column name when your schema uses a different convention:

```ts
public static deletedAtColumn = "archived_at";
```

**The migration adds the column for you.** When the model's strategy resolves to `"soft"`, `Migration.create(Model, { … })` auto-wires the `deletedAt` column (using `deletedAtColumn`) — you don't declare it. Opt out per table with `{ softDeletes: false }`. See [Migrations](../the-basics/migrations.md#the-soft-delete-column).

**Where the filtering happens.** Cascade does **not** automatically hide soft-deleted rows from queries. If you want every `Post.where(...)` query to exclude soft-deleted rows, add a global scope on the model:

```ts
Post.addGlobalScope("notDeleted", q => q.whereNull("deletedAt"));
```

This is intentional — *whether* to hide soft-deleted records is a domain decision (sometimes you want to see them in admin views), and a global scope is the right tool for the job. The [scopes guide](./scopes.md) covers global scopes in depth.

Reach for soft delete when:

- You want the row available for restoration via the same table.
- You don't mind the live table growing — soft-deleted rows still take storage and still get scanned by queries that don't filter them out.
- You want full historical analytics (count of all posts ever created, by any author, since forever).

## `trash` — move to a separate table, then delete

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static deleteStrategy = "trash";
  public static trashTable = "usersTrash"; // optional override
}

await user.destroy();
```

How it works:

- Cascade inserts a copy of the row into a **trash table** (default name: `{table}Trash`, e.g., `postsTrash`). The copy carries the original data plus two metadata fields: `deletedAt` (timestamp) and `originalTable` (where the row came from).
- The original row is then deleted from the source table.
- The model instance is marked as new (its source-table primary key is now gone). Restoration moves the row back from the trash table.

**Configuring the trash table name.** Three options, in priority order:

1. **`Model.trashTable`** — per-model override
2. **`DataSource.defaultTrashTable`** — one shared trash bin for all models (`"RecycleBin"` is a sensible convention on MongoDB)
3. **`{table}Trash`** — default pattern, e.g., `postsTrash`

A shared `RecycleBin` collection on MongoDB is a common pattern — single collection, multi-model, with `originalTable` distinguishing rows. On SQL you'll usually want per-table trash (`postsTrash`, `usersTrash`) so the schema can stay strict.

Reach for trash when:

- You want the live table lean — no soft-deleted rows polluting scans.
- The schema benefits from physical separation (e.g., users get GDPR'd from `users` but you keep a copy elsewhere for audit).
- You'd rather opt **in** to "show me the deleted things" via querying a different table than opt **out** via a global scope.

## Restoring

Both `soft` and `trash` strategies can be restored. `permanent` cannot — Cascade throws explicitly when you try.

### Restore one record by id

```ts
const restored = await User.restore(123);
// → throws if not found in trash/soft-deleted
// → returns the hydrated, live model instance
```

For `soft`, this clears the `deletedAt` column. For `trash`, it inserts the row back into the source table and removes it from the trash table.

### Restore all soft-deleted / all from trash

```ts
const all = await User.restoreAll();
// → restores every deletable record for this model
```

### Handling id conflicts on restore

The interesting edge case is *trash → restore* when the original id has since been reused. (For example, you trashed user 42, someone else got assigned user 42 by an auto-increment, and now you want to restore the old user 42.)

```ts
await User.restore(42, { onIdConflict: "assignNew" }); // default
await User.restore(42, { onIdConflict: "fail" });
```

- **`"assignNew"`** (default) — restore with a freshly-assigned id. Safer.
- **`"fail"`** — throw rather than overwrite or rename. Useful when ids carry business meaning and silent renumbering is a bug.

For UUID-based primary keys this is essentially impossible (collisions don't happen), so the option only matters for auto-increment ids.

### Skipping events on restore

```ts
await User.restore(42, { skipEvents: true });
```

Suppresses the `restoring` / `restored` model events. Use when restoration is part of a larger orchestrated flow that already emits its own events and you'd duplicate them.

## Per-call overrides

You can override the model's configured strategy on a single call:

```ts
// Model is configured for soft delete, but this specific call permanently deletes:
await user.destroy({ strategy: "permanent" });

// Model is permanent by default, but trash this one:
await spamAccount.destroy({ strategy: "trash" });
```

Same with `skipEvents`:

```ts
await user.destroy({ skipEvents: true });
```

Useful for fixture cleanup in tests, GDPR hard-deletes that bypass the audit trail, or background-job retries that have already emitted the parent event.

## Choosing a strategy — a quick decision guide

| You want…                                                              | Reach for     |
| ---------------------------------------------------------------------- | ------------- |
| Row gone. Don't care about it afterwards.                              | `permanent`   |
| Row gone in queries by default, but recoverable                        | `soft` + global scope |
| Row physically out of the live table, but recoverable                  | `trash`       |
| Compliance / audit — keep deleted data, separate it from live data     | `trash`       |
| "Archive" a record without dropping it from history                    | `soft`        |
| Lean live table, no scope to remember                                  | `trash`       |
| Already have separate audit logging                                    | `permanent`   |

## Events

All three strategies emit the same lifecycle events: `deleting` (before) and `deleted` (after). The event context tells you which strategy ran:

```ts
User.events().onDeleting(async (user, ctx) => {
  console.log(ctx.strategy);          // "permanent" | "soft" | "trash"
  console.log(ctx.primaryKeyValue);   // the id being deleted
});

User.events().onDeleted(async (user, ctx) => {
  console.log(ctx.deletedCount);      // 1 (or 0 if the row was already gone)
  console.log(ctx.trashRecord);       // present for "trash" strategy
});
```

See the [events and hooks guide](../architecture-concepts/events-and-hooks.md) for the full event vocabulary and listener patterns.

## Going further

- **Hiding soft-deleted rows automatically** — [Scopes guide](./scopes.md)
- **Listening to delete events** — [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
- **Restoring from trash across model upgrades** — recipe *(planned)*
- **GDPR hard-delete workflows** — recipe *(planned)*
