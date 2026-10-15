---
title: "Define a notification"
description: Reusable multi-channel notifications — static vs dynamic via, per-channel renderers, the ctx arg, send / queue / only.
sidebar:
  label: "Define a notification"
---

`defineNotification` is the reusable pattern: declare `type` + `via` + a renderer per channel; fire with `.send` / `.queue` / `.only`.

```ts
const orderShipped = defineNotification<{ order: Order }>({
  type: "order.shipped",
  via: ["database", "mail"],
  database: ({ order }) => ({ title: `Order #${order.number} shipped` }),
  mail: ({ order }, to) => ({ subject: `Order #${order.number}`, html: `<p>Hi ${to.get("name")}</p>` }),
});
```

## `via` — static or dynamic

A static array fires the same channels every time. A callback picks channels **per recipient**:

```ts
via: (_data, to) =>
  to.get("telegram_chat_id") ? ["database", "telegram"] : ["database", "mail"],
```

A static `via` with a missing renderer throws **at definition time** (a programmer error you want loud, at import). A dynamic `via` that selects a channel with no renderer rejects the `send()`.

## Renderers — `(data, to, ctx)`

Each renderer returns that channel's payload. The third arg, `ctx`, carries `locale` and `meta` from the send options — use it for i18n:

```ts
mail: ({ order }, to, { locale = "en" }) => ({
  subject: subjects[locale],
  html: render(order, locale),
}),
```

The `database` renderer may omit `type` — it's inherited from `def.type`, so the notification type lives in one place.

## Fire it

```ts
await orderShipped.send(user, { order });                 // sync, one recipient
await orderShipped.send([buyer, seller], { order });      // fan-out
await orderShipped.queue(user, { order }, { delay: "10m" }); // async (queue dispatcher)
await orderShipped.only("mail").send(user, { order });    // subset of channels
```

`.send` and `.queue` take an optional 3rd `SendOptions`:

| Option | Effect |
| --- | --- |
| `delay` | Reserved — **not honored yet**; both `.send()` and the current `.queue()` worker dispatch immediately (delay-aware delivery is a follow-up) |
| `locale` | Passed to renderers via `ctx` |
| `meta` | Passed to renderers + included in every observability event |
| `idempotencyKey` | Dedupe the in-app row on retry |
| `force` | Bypass preferences (NOT rate limits) |

## Failure semantics

- **Transport failure** (a channel's `send` throws) → isolated: emitted as a `failed` event, never aborts sibling channels or recipients.
- **Config error** (missing renderer, no queue dispatcher) → rejects the `send()`/`queue()` promise. Misconfiguration is loud.

## Next

- [Ad-hoc sends](./send-ad-hoc.md) — when a definition is overkill.
- [Preferences & rate limits](./preferences-and-rate-limits.md) — gate the dispatch.
- [Observability](./observability.md) — watch the outcomes.
