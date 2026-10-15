---
name: use-in-app
description: 'Use the `inApp` facade for the in-app/database channel''s READ side: `inApp.configure({ model: Notification })` or `{ repository: myRepo }` binds the store AND returns the channel; `inApp.list / listUnread / countUnread / markAsRead / markAsUnread` are RECIPIENT-SCOPED by construction (no IDOR — `markAsRead(user, id)` cannot flip another user''s row even with a foreign id). `countUnread` uses `RepositoryManager.countCached` for the badge fast-path. Triggers: `inApp.configure`, `inApp.list`, `inApp.listUnread`, `inApp.countUnread`, `inApp.markAsRead`, `inApp.markAsUnread`, `BaseNotificationsRepository`, `DatabaseNotification`, `NotificationsFilter`, "in-app notifications", "mark notification as read", "unread count", "notification badge", "IDOR-safe markAsRead"; typical import `import { inApp } from "@warlock.js/notifications"`. Skip: writing notifications (use `defineNotification` or `notify.database`) — the `define-notification` topic; the migration columns — the `write-notification-migration` topic; wiring it into config — the `configure-notifications` topic.'
---

# `inApp` — in-app notification read API

The in-app database channel has two sides:

- **Write side** — `notify.database(user, {...})` and the database channel inside `defineNotification` create rows.
- **Read side** — `inApp.list` / `listUnread` / `countUnread` / `markAsRead` / `markAsUnread` query and mutate.

`inApp.configure({ model | repository })` binds the same repository for both sides, so cache invalidation just works.

## Configure (once, in `config/notifications.ts`)

```ts
// 90% case — pass the model class; default repo built internally.
database: inApp.configure({ model: Notification }),

// 10% case — pass a custom repo.
database: inApp.configure({ repository: notificationsRepository }),
```

## Reads

```ts
import { inApp } from "@warlock.js/notifications";

// all rows for this recipient (paginated via the repo's standard `list`)
const all = await inApp.list(user);

// unread-only — pass `filter` to add type/etc. constraints
const unread = await inApp.listUnread(user, { type: "order.shipped" });

// cached unread count — backs the badge
const badge = await inApp.countUnread(user);

// one notification — for a detail view (recipient-scoped)
const one = await inApp.find(user, "ntf_123");
```

All read methods accept a cascade `Notifiable` model OR a raw `id` (string | number) — convenient when you only have an id without fetching the user.

```ts
await inApp.list("user_42");
await inApp.countUnread(123);
```

## Writes (recipient-scoped → no IDOR)

```ts
// mark ALL unread rows for this recipient as read
await inApp.markAsRead(user);

// mark ONE specific row — STILL scoped to this recipient
await inApp.markAsRead(user, "ntf_123");

// inverse
await inApp.markAsUnread(user, "ntf_123");

// delete / dismiss — one row, or clear all for this recipient
await inApp.dismiss(user, "ntf_123");
await inApp.dismiss(user);
```

The recipient-id is forced into the `where` clause. A controller that receives an `id` from the request and naively calls `inApp.markAsRead(currentUser, id)` cannot accidentally flip another user's row — even if the request contains a forged id. The mutation will simply update 0 rows.

## Behind the scenes — `columnMap` drives everything

The model declares its physical columns ONCE via `static columnMap`. The
shipped `DatabaseNotification` accessors and `BaseNotificationsRepository`
(read filter + write mapping) both derive from it, so they can never drift:

```ts
abstract class DatabaseNotification extends Model implements NotificationContract {
  public static columnMap: NotificationColumnMap = {};
  // recipientId / tenantId / isRead / readAt / markRead all read `columnMap`.
}

class BaseNotificationsRepository extends RepositoryManager {
  // constructor resolves the model's columnMap → builds `filterBy` +
  // createFor / markRead / markUnread / deleteFor from it.
  public createFor(recipientId, input, tenantId?)   { /* one insert, starts unread */ }
}
```

### `createFor` write side — no IDOR either (since 4.15.0)

`recipientId` is always the trusted argument, applied **after** the payload — `createFor`/`createManyFor` strip server-owned keys (`id`, `recipientId`, `tenant`, `readAt`, `isRead`, and their resolved `columnMap` physical column names) off `input` before merging. Before this, a caller passing an untyped payload straight through (request JSON, a channel's `send` args) could smuggle its own `recipientId` — or the raw physical column name — and write the notification into someone else's inbox. `type` / `title` / `body` / `payload` / `idempotencyKey` are untouched; you don't need to sanitize `input` yourself.

### `columnMap` — map logical roles → your columns

```ts
export type NotificationColumnMap = {
  recipient?: string; // recipient FK. Default "user_id"
  tenant?: string;    // multi-tenant scope, written from the recipient. Omit → single-tenant
  readAt?: string;    // read-timestamp column
  isRead?: string;    // read-flag column (indexed)
};
```

**Read-state is chosen by which keys are PRESENT:**

- `readAt` only → unread = `read_at IS NULL`; marking read stamps it.
- `isRead` only → unread = `is_read = false`; no timestamp.
- both → `is_read` is the indexed filter flag, `read_at` records WHEN.

Declare neither and you get the `readAt`-only default — so a model can omit
`columnMap` entirely. `unread` is the mode-agnostic read filter on `inApp` /
the repo; there is no `isRead` filter key to remember.

## Your model — declare `table`, `schema`, and `columnMap`

```ts title="src/app/notifications/notification.model.ts"
import { RegisterModel } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";
import { DatabaseNotification, type NotificationColumnMap } from "@warlock.js/notifications";

// Mirrors the migration columns; cascade validates + casts every write.
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
  // read_at-only, single-tenant. Add `tenant: "organization_id"` for multi-tenant,
  // swap to `isRead: "is_read"` (or add it) to change the read-state representation.
  public static columnMap: NotificationColumnMap = { readAt: "read_at" };
}
```

To change columns, edit `columnMap` — the migration (`notificationColumns`), the
repo filter, and the accessors all follow. For a different driver's naming
(e.g. MongoDB camelCase), name the columns in `columnMap`
(`{ recipient: "userId", readAt: "readAt" }`).

## Custom repository (advanced, optional)

`columnMap` already covers column naming. Subclass only for EXTRA query methods:

```ts title="src/app/notifications/notifications.repository.ts"
import { BaseNotificationsRepository } from "@warlock.js/notifications";
import { Notification } from "./notification.model";

export class NotificationsRepository extends BaseNotificationsRepository<Notification> {
  public source = Notification; // its columnMap still drives filter + write mapping
  // …extra methods specific to your app
}
export const notificationsRepository = new NotificationsRepository();
```

Then swap config:

```ts
database: inApp.configure({ repository: notificationsRepository }),
```

## See also

- The `notifications-basics` topic — package front door.
- The `configure-notifications` topic — wire `inApp.configure` into the config.
- The `write-notification-migration` topic — `notificationColumns(Notification)`, named from `columnMap`.
- The `define-notification` topic — create rows via the database channel.
