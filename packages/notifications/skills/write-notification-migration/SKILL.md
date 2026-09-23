---
name: write-notification-migration
description: "Write the notifications migration in @warlock.js/notifications; use when you need to write notification migration."
---

# Write the notifications migration

The package ships no table or migration (thin eject). You own the migration; the package gives you a column factory that names columns from your model's `columnMap`, so it's one line.

> `npx warlock add notifications` scaffolds this migration (+ the model) for you. Reach for this skill when you need to customize columns or add extras.

## Common case — one line

```ts title="src/app/notifications/migrations/01-01-2026_00-00-00-notifications.migration.ts"
import { Migration } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, notificationColumns(Notification));
```

`notificationColumns(Notification)` reads the model's `columnMap` and returns the
matching columns:

| columnMap | Columns |
|---|---|
| _(none / default)_ | `user_id`, `type`, `title`, `body`, `payload`, `read_at`, `idempotency_key` |
| `{ tenant: "organization_id", readAt: "read_at" }` | adds `organization_id`; read_at-only |
| `{ isRead: "is_read" }` | swaps `read_at` for `is_read` (indexed boolean) |
| `{ isRead: "is_read", readAt: "read_at" }` | both read-state columns |

The recipient / tenant / read-state column NAMES come from `columnMap`; `type` /
`title` / `body` / `payload` / `idempotency_key` are fixed. `id` / `createdAt` /
`updatedAt` are added automatically by cascade.

## With extras — spread + extend

Add your own columns — a category, a source channel, a tenant id, anything:

```ts
import { Migration, string } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, {
  ...notificationColumns(Notification),
  category: string().index().nullable(),
});
```

Mirror any extra column in the model `schema`. To make it filterable, add a method to a custom repository (see `use-in-app/SKILL.md`).

## Column naming follows `columnMap`

The factory does NOT guess names from the driver — it reads the model's `columnMap`. To match a different convention (e.g. MongoDB camelCase), name the columns there and the migration follows:

```ts
class Notification extends DatabaseNotification {
  public static columnMap = { recipient: "userId", readAt: "readAt" };
}
// → notificationColumns(Notification) emits `userId` + `readAt`
```

Without a model passed, defaults to `user_id` + `read_at` (read_at-only). See [`use-in-app/SKILL.md`](../use-in-app/SKILL.md) for the full `columnMap` shape.

## See also

- [`use-in-app/SKILL.md`](../use-in-app/SKILL.md) — the model + repository the migration backs.
- [`@warlock.js/cascade/write-migration/SKILL.md`](../../../cascade/skills/write-migration/SKILL.md) — generic Cascade migration form, `Migration.alter`, etc.
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](../../../cascade/skills/manage-data-sources/SKILL.md) — multi-data-source setup.
