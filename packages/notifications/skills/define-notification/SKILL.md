---
name: define-notification
description: "defineNotification — reusable multi-channel notification in @warlock.js/notifications; use when you need to define notification."
---

# `defineNotification` — reusable multi-channel notification

The reusable pattern. Define a notification once with `type` + `via` + a renderer per channel; fire it anywhere with `.send` / `.queue` / `.only`.

## Shape

```ts
defineNotification<Data>({
  type: string,                                       // REQUIRED — gate key + database default
  via: ChannelName[] | (data, to) => ChannelName[],   // static array OR per-recipient callback
  mail?:     (data, to, ctx) => MailPayload,
  database?: (data, to, ctx) => Omit<DatabasePayload, "type">, // `type` defaulted from `def.type`
  // ...one renderer per channel listed in `via`
});
```

Returns `{ send, queue, only }`:

| Method | Signature | What it does |
|---|---|---|
| `.send` | `(to, data, options?)` | Render + dispatch synchronously. |
| `.queue` | `(to, data, options?)` | Render + enqueue. Throws if no queue dispatcher is configured. |
| `.only(...channels)` | returns `{send, queue, only}` | Restrict dispatch to a subset of channels. |

`to` accepts a `Notifiable` OR a `Notifiable[]`. Fan-out emits one render+dispatch per recipient with per-recipient + per-channel `Promise.allSettled` (one failure does not abort the others).

## Static `via`

```ts
export const welcome = defineNotification<{ name: string }>({
  type: "welcome",
  via: ["mail"],
  mail: ({ name }) => ({ subject: "Welcome", html: `<p>Hi ${name}</p>` }),
});

await welcome.send(user, { name: "Hasan" });
```

## Dynamic `via` per recipient

```ts
export const orderShipped = defineNotification<{ order: Order }>({
  type: "order.shipped",
  via: (_data, to) =>
    to.get("telegram_chat_id")
      ? ["database", "telegram"]
      : ["database", "mail"],
  database: ({ order }) => ({ title: `Order #${order.number} shipped` }),
  mail: ({ order }, to) => ({
    subject: `Order #${order.number} shipped`,
    html: `<p>Hi ${to.get("name")}, on the way.</p>`,
  }),
  // telegram: ... (Phase 2 — bridges)
});
```

## The renderer's 3rd arg — `RenderContext`

```ts
mail: ({ campaignId }, to, { locale = "en", meta }) => ({
  subject: subjectsByLocale[locale],
  html:    htmlByLocale[locale],
}),

// usage:
await marketing.queue(user, payload, {
  locale: user.get("locale"),
  meta:   { campaignId, source: "blast" },
});
```

`ctx` carries `locale` + `meta` from `SendOptions`. `meta` flows through to every observability event too.

## Database channel — `type` is defaulted

The `database` renderer may OMIT `type` — the dispatcher injects `def.type` automatically. This keeps the notification type in ONE place.

```ts
defineNotification({
  type: "order.shipped",   // ← single source of truth
  via: ["database"],
  database: () => ({ title: "Shipped" }), // type omitted; dispatcher injects "order.shipped"
});
```

## Fan-out

```ts
await orderShipped.send([buyer, salesRep], { order });
// One render+dispatch per recipient. Database does N inserts (Phase 0);
// Phase 1 ships a single bulk insert via `Channel.sendMany?`.
```

## `.only(...)` — restrict channels

```ts
await orderShipped.only("mail").send(user, { order });
// `via` is filtered to just "mail"; other channels are skipped.
```

## Queue (Phase 2)

```ts
await orderShipped.queue(user, { order }, { delay: "10m" });
// Throws NoQueueDispatcherError if no `queue` is configured in config/notifications.ts.
```

## SendOptions

| Field | Effect |
|---|---|
| `delay` | Reserved — `"10m"` / `"3d"` / `600` (seconds). NOT honored yet: both `.send()` and the current `.queue()` worker dispatch immediately; delay-aware delivery is a follow-up. |
| `locale` | Passed to renderers via `RenderContext.locale`. |
| `meta` | Passed to renderers + included in every observability event. |
| `idempotencyKey` | Injected into the database payload (dedupe via unique index). |
| `force` | Bypass `PreferenceProvider`. Does NOT bypass `RateLimiter`. |
| `type` | Ignored by `defineNotification` — see `send-ad-hoc` for ad-hoc gating. |

## Failure isolation

Per-recipient: each recipient gets an independent `Promise.allSettled`. Per-channel: each channel within a recipient gets an independent `allSettled`. A throw becomes a `failed` event on the event bus AND re-throws within its own slot — never aborts siblings.

## See also

- [`notifications-basics/SKILL.md`](../notifications-basics/SKILL.md) — package front door.
- [`send-ad-hoc/SKILL.md`](../send-ad-hoc/SKILL.md) — `notify.<channel>` per-channel shorthand.
- [`configure-notifications/SKILL.md`](../configure-notifications/SKILL.md) — wire channels + preferences + rate-limit + queue.
- [`observe-notifications/SKILL.md`](../observe-notifications/SKILL.md) — `notifications.on("sending" | "sent" | "failed" | "skipped", …)`.
