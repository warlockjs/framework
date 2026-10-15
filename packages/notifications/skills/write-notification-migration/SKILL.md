---
name: write-notification-migration
description: 'Create the notifications table with the `notificationColumns(Notification)` factory + cascade `Migration.create`. Column NAMES come from the model''s `columnMap` (recipient / tenant / readAt / isRead); the fixed columns are `type` / `title` / `body` / `payload` / `idempotency_key`. Set `{ idType: "bigint" }` for integer-key apps; UUID remains the default. Read-state follows columnMap presence: `readAt` → nullable timestamp, `isRead` → indexed boolean, both → both. Defaults to `user_id` + `read_at` when no columnMap. Spread + extend for extras (FK references, composite indexes). Triggers: `notificationColumns`, `Migration.create` for notifications, "create the notifications table", "notification migration", "add organization_id to notifications", `is_read` column, `read_at` column, `idempotency_key` column; typical import `import { Migration } from "@warlock.js/cascade"; import { notificationColumns } from "@warlock.js/notifications"`. Skip: generic cascade migration writing — the `write-migration` topic of the `warlock-js-cascade` skill; the model itself — the `use-in-app` topic.'
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

## Match your app's identifier type

Recipient and tenant columns default to UUID. For applications whose primary keys
are `bigint`, `integer`, or strings, pass `idType`; it is applied to every
identifier column the factory creates:

```ts
export default Migration.create(Notification, notificationColumns(Notification, { idType: "bigint" }));
```

## With extras — spread + extend

Add your own columns — a category, a source channel, a tenant id, anything:

```ts
import { Migration, string } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, {
  ...notificationColumns(Notification, { idType: "bigint" }),
  category: string().index().nullable(),
});
```

Mirror any extra column in the model `schema`. To make it filterable, add a method to a custom repository (see the `use-in-app` topic).

## Column naming follows `columnMap`

The factory does NOT guess names from the driver — it reads the model's `columnMap`. To match a different convention (e.g. MongoDB camelCase), name the columns there and the migration follows:

```ts
class Notification extends DatabaseNotification {
  public static columnMap = { recipient: "userId", readAt: "readAt" };
}
// → notificationColumns(Notification) emits `userId` + `readAt`
```

Without a model passed, defaults to `user_id` + `read_at` (read_at-only). See the `use-in-app` topic for the full `columnMap` shape.

## See also

- The `use-in-app` topic — the model + repository the migration backs.
- The `write-migration` topic of the `warlock-js-cascade` skill — generic Cascade migration form, `Migration.alter`, etc.
- The `manage-data-sources` topic of the `warlock-js-cascade` skill — multi-data-source setup.
