---
name: use-in-app
description: 'Use the `inApp` facade for the in-app/database channel''s READ side: `inApp.configure({ model: Notification })` or `{ repository: myRepo }` binds the store AND returns the channel; `inApp.list / listUnread / countUnread / markAsRead / markAsUnread` are RECIPIENT-SCOPED by construction (no IDOR — `markAsRead(user, id)` cannot flip another user''s row even with a foreign id). `countUnread` uses `RepositoryManager.countCached` for the badge fast-path. Triggers: `inApp.configure`, `inApp.list`, `inApp.listUnread`, `inApp.countUnread`, `inApp.markAsRead`, `inApp.markAsUnread`, `BaseNotificationsRepository`, `DatabaseNotification`, `NotificationsFilter`, "in-app notifications", "mark notification as read", "unread count", "notification badge", "IDOR-safe markAsRead"; typical import `import { inApp } from "@warlock.js/notifications"`. Skip: writing notifications (use `defineNotification` or `notify.database`) — `@warlock.js/notifications/define-notification/SKILL.md`; the migration columns — `@warlock.js/notifications/write-notification-migration/SKILL.md`; wiring it into config — `@warlock.js/notifications/configure-notifications/SKILL.md`.'
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

## Behind the scenes — the model + repo

The package ships:

```ts
// extend this in your app's notification model
abstract class DatabaseNotification extends Model implements NotificationContract {
  public get recipientId(): Id      { return this.get("user_id"); }
  public get type(): string         { return this.get("type"); }
  public get isRead(): boolean      { return this.get("is_read") ?? false; }
  public get readAt(): Date | null  { return this.get("read_at") ?? null; }
  public async markRead(): Promise<void> {
    this.set("is_read", true).set("read_at", new Date());
    await this.save();
  }
}

// shipped behavior repository (concrete — extend only for filterBy overrides)
class BaseNotificationsRepository extends RepositoryManager {
  public filterBy = {
    id:              "=",
    type:            "=",
    isRead:          ["=", "is_read"],
    recipientId:     ["=", "user_id"],
    idempotencyKey:  ["=", "idempotency_key"],
  };
  public createFor(recipientId, input)            { /* one insert, isRead: false */ }
  public createManyFor(recipientIds, input)       { /* bulk fan-out */ }
}
```

## Your model — override only what differs

```ts title="src/app/notifications/notification.model.ts"
import { RegisterModel } from "@warlock.js/cascade";
import { DatabaseNotification } from "@warlock.js/notifications";

@RegisterModel()
export class Notification extends DatabaseNotification {
  public static table = "notifications";
  // Override accessors ONLY when your columns or driver diverge.
  // Example (MongoDB nested doc): public get recipientId() { return this.get("user.id"); }
}
```

## Custom repository (advanced, optional)

Only when you need custom `filterBy` mappings or extra query methods:

```ts title="src/app/notifications/notifications.repository.ts"
import { BaseNotificationsRepository } from "@warlock.js/notifications";
import { Notification } from "./notification.model";

export class NotificationsRepository extends BaseNotificationsRepository<Notification> {
  public source = Notification;

  public filterBy = {
    ...this.filterBy,
    recipientId: ["=", "audience_id"],   // remap to your column
    isRead:      ["=", "seen"],
  };

  // …extra methods specific to your app
}
export const notificationsRepository = new NotificationsRepository();
```

Then swap config:

```ts
database: inApp.configure({ repository: notificationsRepository }),
```

## See also

- [`notifications-basics/SKILL.md`](../notifications-basics/SKILL.md) — package front door.
- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — wire `inApp.configure` into the config.
- [`write-notification-migration/SKILL.md`](../write-notification-migration/SKILL.md) — `notificationColumns(Notification)` driver-aware factory.
- [`define-notification/SKILL.md`](../define-notification/SKILL.md) — create rows via the database channel.
