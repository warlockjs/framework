---
name: write-notification-migration
description: 'Create the notifications table with the driver-aware `notificationColumns(Notification)` factory + cascade `Migration.create`. Returns snake_case columns on PG/MySQL (`user_id`, `is_read`, `read_at`, `idempotency_key`) or camelCase on MongoDB (`userId`, `isRead`, `readAt`, `idempotencyKey`) — picked from the model''s `static dataSource`. Spread + extend for extras (multi-tenant `organization_id`, etc.). Triggers: `notificationColumns`, `Migration.create` for notifications, "create the notifications table", "notification migration", "add organization_id to notifications", `is_read` column, `idempotency_key` column; typical import `import { Migration } from "@warlock.js/cascade"; import { notificationColumns } from "@warlock.js/notifications"`. Skip: generic cascade migration writing — `@warlock.js/cascade/write-migration/SKILL.md`; the model itself — `@warlock.js/notifications/use-in-app/SKILL.md`.'
---

# Write the notifications migration

The package ships no table or migration (thin eject). You own the migration; the package gives you a driver-aware column factory so it's one line.

## Common case — one line

```ts title="src/app/notifications/migrations/01-01-2026_00-00-00-notifications.migration.ts"
import { Migration } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, notificationColumns(Notification));
```

`notificationColumns(Notification)` reads the model's `static dataSource` and returns:

| Driver | Columns (`user_id` / `userId` etc.) |
|---|---|
| PG / MySQL (default) | `user_id`, `type`, `title`, `body`, `payload`, `is_read`, `read_at`, `idempotency_key` |
| MongoDB | `userId`, `type`, `title`, `body`, `payload`, `isRead`, `readAt`, `idempotencyKey` |

`id` / `createdAt` / `updatedAt` are added automatically by cascade.

## With extras — spread + extend

Add multi-tenant `organization_id`, category, or anything else:

```ts
import { Migration, uuid } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, {
  ...notificationColumns(Notification),
  organization_id: uuid().index().notNullable(),
});
```

The dev's repository's `filterBy` should reference the extra columns if you want them addressable from `inApp.list({ organizationId })` etc.

## Detection

`notificationColumns(model)` returns camelCase **only** when the model declares `static dataSource = "mongodb"` (or a `DataSource` object whose `name` is `"mongodb"`). Everything else — PG / MySQL / unset — returns snake_case.

```ts
class Notification extends DatabaseNotification {
  public static dataSource = "mongodb"; // ← triggers camelCase
}
```

Without a model passed, defaults to SQL (snake_case).

## See also

- [`use-in-app/SKILL.md`](../use-in-app/SKILL.md) — the model + repository the migration backs.
- [`@warlock.js/cascade/write-migration/SKILL.md`](../../../cascade/skills/write-migration/SKILL.md) — generic Cascade migration form, `Migration.alter`, etc.
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](../../../cascade/skills/manage-data-sources/SKILL.md) — multi-data-source setup.
