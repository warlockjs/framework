---
title: "Your first notification"
description: Model, migration, definition, send, and read — a complete in-app + email notification end to end.
sidebar:
  order: 3
  label: "Your first notification"
---

We'll ship `order.shipped` through **mail + in-app**, then read it back.

## 1. The model

`warlock add notifications` scaffolds this; here's what it looks like. Extend the shipped base and declare your columns via `columnMap`.

```ts title="src/app/notifications/notification.model.ts"
import { RegisterModel } from "@warlock.js/cascade";
import { DatabaseNotification, type NotificationColumnMap } from "@warlock.js/notifications";
import { v } from "@warlock.js/seal";

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

  // Single-tenant, read_at-only. Add `tenant: "organization_id"` for multi-tenant.
  public static columnMap: NotificationColumnMap = { readAt: "read_at" };
}
```

## 2. The migration

One line — the columns are named from your model's `columnMap`:

```ts title="src/app/notifications/migrations/…notification.migration.ts"
import { Migration } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

export default Migration.create(Notification, notificationColumns(Notification));
```

```bash
yarn cascade migrate
```

## 3. The definition

```ts title="src/app/orders/notifications/order-shipped.ts"
import { defineNotification } from "@warlock.js/notifications";
import type { Order } from "app/orders/models/order";

export const orderShipped = defineNotification<{ order: Order }>({
  type: "order.shipped",
  via: ["database", "mail"],

  database: ({ order }) => ({
    title: `Order #${order.get("number")} shipped`,
    body: "Your order is on its way.",
    payload: { orderId: order.id },
    // `type` is inherited from `def.type` — no need to repeat it
  }),

  mail: ({ order }, to) => ({
    subject: `Order #${order.get("number")} shipped`,
    html: `<p>Hi ${to.get("name")}, your order is on the way.</p>`,
  }),
});
```

## 4. Send it

```ts
await orderShipped.send(user, { order });           // mail + an in-app row
await orderShipped.send([buyer, seller], { order }); // fan-out to a list
await orderShipped.only("database").send(user, { order }); // just the in-app row
```

## 5. Read the in-app side

```ts
import { inApp } from "@warlock.js/notifications";

const badge  = await inApp.countUnread(user);          // for the bell badge
const unread = await inApp.listUnread(user);           // the dropdown list
await inApp.markAsRead(user, "ntf_123");               // user clicked one
await inApp.markAsRead(user);                          // "mark all read"
```

Every read and write is scoped to the recipient — passing a notification id that belongs to a different user simply matches nothing.

## Where next

- [Channels & the registry](../essentials/01-channels-and-the-registry.md) — how channels resolve a recipient's address, and how to type a custom one.
- [Define a notification](../guides/define-notification.md) — dynamic `via`, per-channel rendering, `ctx` for i18n.
- [The in-app store](../essentials/02-the-in-app-store.md) — the model, repository, and read API in depth.
