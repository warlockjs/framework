---
title: "Transactional, security & marketing"
description: Worked recipes — welcome, order-shipped, a forced security alert, a rate-limited marketing blast, and staff fan-out.
sidebar:
  label: "Recipes"
---

Five patterns covering the spread of real notification needs.

## 1. Welcome — simplest

```ts
export const welcome = defineNotification<{ name: string }>({
  type: "welcome",
  via: ["mail"],
  mail: ({ name }) => ({ subject: "Welcome!", html: `<p>Hi ${name}, thanks for joining.</p>` }),
});

await welcome.send(user, { name: user.get("name") });
```

## 2. Order shipped — multi-channel, dynamic via

```ts
export const orderShipped = defineNotification<{ order: Order }>({
  type: "order.shipped",
  via: (_d, to) => (to.get("telegram_chat_id") ? ["database", "telegram"] : ["database", "mail"]),
  database: ({ order }) => ({ title: `Order #${order.number} shipped`, payload: { id: order.id } }),
  mail: ({ order }, to) => ({ subject: `Order #${order.number} shipped`, html: `<p>Hi ${to.get("name")}…</p>` }),
});

await orderShipped.send(user, { order });
```

## 3. Security alert — `force` past mutes + idempotent

A user must learn their password changed even if they muted `security.*`. `force` bypasses preferences; `idempotencyKey` makes a retried alert a no-op.

```ts
export const passwordChanged = defineNotification<{ ip: string }>({
  type: "security.password_changed",
  via: ["database", "mail"],
  database: ({ ip }) => ({ title: "Password changed", body: `From ${ip}.` }),
  mail: ({ ip }) => ({ subject: "Your password was changed", html: `<p>IP: ${ip}</p>` }),
});

await passwordChanged.send(user, { ip }, { force: true, idempotencyKey: `pwd:${user.id}:${changeId}` });
```

## 4. Marketing blast — rate-limited, localized, queued

With a `RateLimiter` policy capping `marketing.*` mail, excess sends drop as `skipped`; the queue paces delivery.

```ts
export const weeklyDigest = defineNotification<{ items: Item[] }>({
  type: "marketing.weekly",
  via: ["mail"],
  mail: ({ items }, to, { locale = "en" }) => ({
    subject: t("digest.subject", locale),
    html: renderDigest(items, locale),
  }),
});

for (const chunk of subscribers.chunk(500)) {
  await weeklyDigest.queue(chunk, { items }, { meta: { blastId }, locale: chunk[0].get("locale") });
}
```

## 5. Staff hand-off — fan-out to a custom channel

```ts
export const handoff = defineNotification<{ conversationId: string; reason: string }>({
  type: "support.handoff",
  via: ["database", "slack"], // slack = a custom defineChannel
  database: ({ conversationId, reason }) => ({ title: "Needs attention", body: reason, payload: { conversationId } }),
  slack: ({ conversationId, reason }) => ({ text: `🆘 #${conversationId}: ${reason}` }),
});

await handoff.send(onCallStaff, { conversationId, reason }); // one call, N staff
```

## Reading the in-app side

```ts
const badge  = await inApp.countUnread(user);
const unread = await inApp.listUnread(user, { type: "order.shipped" });
await inApp.markAsRead(user);          // mark all read
await inApp.dismiss(user, "ntf_123");  // delete one
```

## See also

- [Define a notification](../guides/define-notification.md) · [Preferences & rate limits](../guides/preferences-and-rate-limits.md) · [Custom channels](../guides/custom-channels.md)
