---
title: "The in-app store"
description: The DatabaseNotification model, BaseNotificationsRepository, the recipient-scoped read API, and the logical→physical column mapping.
sidebar:
  order: 2
  label: "The in-app store"
---

The `database` channel persists notifications and powers the in-app notification center — unread badges, a dropdown list, mark-as-read. Three pieces: a **model**, a **repository**, and the **`inApp` facade**.

## The read API — recipient-scoped by construction

```ts
import { inApp } from "@warlock.js/notifications";

await inApp.list(user, { type: "order.shipped" }); // all — optional filter + paging (page / limit)
await inApp.listUnread(user);                        // unread only
await inApp.countUnread(user);                       // cached — backs the badge
await inApp.find(user, "ntf_123");                   // one — for a detail view

await inApp.markAsRead(user, "ntf_123");             // one
await inApp.markAsRead(user);                        // all unread for this user
await inApp.markAsUnread(user, "ntf_123");
await inApp.dismiss(user, "ntf_123");                // delete one
await inApp.dismiss(user);                           // clear all for this user
```

Every method forces the recipient id into the query. `markAsRead(user, id)` with an `id` belonging to a *different* user matches zero rows — **IDOR-safe by construction**, not by a guard you might forget. All methods accept a cascade model or a raw id.

## The model

Extend the shipped base and declare your physical columns once via `columnMap` — the accessors are the stable contract, the column names are yours. The `schema` mirrors the migration columns; cascade validates + casts every write against it:

```ts
import { v } from "@warlock.js/seal";
import { DatabaseNotification, type NotificationColumnMap } from "@warlock.js/notifications";

const notificationSchema = v.object({
  user_id: v.string(),
  type: v.string(),
  title: v.string(),
  body: v.string().nullish(),
  payload: v.record(v.any()).nullish(),
  read_at: v.date().nullish(),
  idempotency_key: v.string().nullish(),
});

@RegisterModel()
export class Notification extends DatabaseNotification {
  public static table = "notifications";
  public static schema = notificationSchema;

  // Single-tenant, read_at-only. The accessors, repo, and migration all follow this.
  public static columnMap: NotificationColumnMap = { readAt: "read_at" };
}
```

`DatabaseNotification` exposes `recipientId` / `tenantId` / `isRead` / `readAt` / `markRead()` — all derived from `columnMap`. You rarely touch the class directly; the read/write API is the `inApp` facade.

### `columnMap` — map roles to columns

```ts
type NotificationColumnMap = {
  recipient?: string; // recipient FK. Default "user_id"
  tenant?: string;    // multi-tenant scope, written from the recipient. Omit → single-tenant
  readAt?: string;    // read-timestamp column
  isRead?: string;    // read-flag column (indexed)
};
```

Which read-state keys are **present** chooses the representation:

- `readAt` only → unread is `read_at IS NULL`; marking read stamps it.
- `isRead` only → unread is `is_read = false`; no timestamp.
- both → `is_read` is the indexed filter flag, `read_at` records *when*.

Declare neither and you get the `readAt`-only default. For multi-tenant, add `tenant: "organization_id"` — the `database` channel reads that column off the recipient and writes it on every row, no custom channel needed.

## The repository — derived from `columnMap`

The package ships a **concrete** `BaseNotificationsRepository`; `inApp.configure({ model })` instantiates it for you. Its constructor resolves the model's `columnMap` and builds **both** sides from it:

- the **read** filter (`filterBy`) — logical keys (`recipientId`, `unread`, `type`, …) mapped to your columns;
- the **write / update / delete** mapping used by `createFor` / `markRead` / `dismiss`.

Because both come from one `columnMap`, reads and writes can never disagree on a column name. The `unread` filter is mode-agnostic — it resolves to `is_read = false` or `read_at IS NULL` depending on your map.

Subclass the repository only for **extra query methods** — column naming already lives on the model:

```ts title="extra methods only"
class NotificationsRepository extends BaseNotificationsRepository<Notification> {
  public source = Notification; // its columnMap still drives the filter + write mapping
  // …app-specific finders
}
inApp.configure({ repository: new NotificationsRepository() });
```

## Idempotency

Pass `idempotencyKey` and `createFor` does **find-or-create** — a retried send returns the existing row instead of inserting a duplicate. A unique constraint on the column is the race backstop (the repo re-fetches on conflict).

```ts
await orderShipped.send(user, { order }, { idempotencyKey: `ship:${order.id}` });
```

## Next

- [Define a notification](../guides/define-notification.md) — write the database renderer.
- [Observability](../guides/observability.md) — track sending / sent / failed / skipped.
- [API reference](../reference/api.md) — full `inApp` surface.
