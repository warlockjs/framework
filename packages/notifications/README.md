# @warlock.js/notifications

Multi-channel notifications for Warlock.js — **define once, fire anywhere**.

- 📬 **Mail** via `@warlock.js/core`'s `sendMail`.
- 🗄️ **In-app database** with a recipient-scoped read API (no IDOR by construction).
- 🔌 **Custom channels** via `defineChannel` (3-line escape hatch).
- 🎚️ **Pluggable gates** for user preferences + rate limits.
- 🔐 **`force` + `idempotencyKey`** on every send.
- 📊 **Observability events** — `sent` / `failed` / `skipped`.

> WhatsApp / Telegram / Slack / Push channels arrive with `@warlock.js/bridges` (Phase 2). Until then, roll your own with `defineChannel` + `fetch` — see the example app's `internal-webhook.channel.ts`.

## Quick start

```bash
# installs the package, ejects a declarative config/notifications.ts,
# and scaffolds the in-app model + migration into src/app/notifications/*
npx warlock add notifications
```

```ts
// src/app/orders/notifications/order-shipped.ts
import { defineNotification } from "@warlock.js/notifications";

export const orderShipped = defineNotification<{ order: Order }>({
  via: ["mail", "database"],
  mail: ({ order }, to) => ({
    subject: `Order #${order.number} shipped`,
    html: `<p>Hi ${to.get("name")}, your order is on the way.</p>`,
  }),
  database: ({ order }) => ({
    type: "order.shipped",
    title: "Your order shipped",
    payload: { orderId: order.id },
  }),
});

// anywhere
await orderShipped.send(user, { order });
await orderShipped.queue(buyers, { order }, { delay: "10m" });

// ad-hoc
await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });

// in-app reads
await inApp.listUnread(user);
await inApp.markAsRead(user); // recipient-scoped — no IDOR
```

## Skills

The package ships `skills/<task>/SKILL.md` files describing every public surface. Browse the index at [`skills/README.md`](./skills/README.md) or load them via `agent-kit`.

## License

MIT
