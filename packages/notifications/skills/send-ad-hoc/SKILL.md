---
name: send-ad-hoc
description: 'Ad-hoc per-channel send via the `notify.<channel>(to, payload, options?)` Proxy facade. Works for any channel registered in `NotificationChannels` (built-in or custom). `to` accepts a `Notifiable` model OR a raw route string (`"x@y.com"`); `payload` is typed per channel via the registry; `options` is the standard `SendOptions`. `notify.channel(name).send(...)` is the runtime escape when the channel name is not a compile-time literal. Type-based preference gating applies when a type is known — explicit via `options.type` OR auto-detected from a database payload''s `type` field. For multi-channel sends use `defineNotification` instead — there is no inline `notify(to, { via, ... })` form on purpose. Triggers: `notify.<channel>`, `notify.channel(name)`, `notify.mail`, `notify.database`, "send a one-off notification", "ad-hoc notification", "send an email without defining a notification", "raw email target", "dynamic channel name"; typical import `import { notify } from "@warlock.js/notifications"`. Skip: reusable multi-channel notifications — the `define-notification` topic; configuring channels — the `configure-notifications` topic.'
---

# `notify.<channel>` — ad-hoc, per-channel sends

When you don't need a reusable definition — fire one channel, one recipient.

```ts
import { notify } from "@warlock.js/notifications";

await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });
await notify.database(user, { type: "welcome", title: "Welcome!" });
```

For **multi-channel** sends, use `defineNotification` (the `define-notification` topic) — that's the reusable pattern and the only mental model for "send through several channels at once" (no inline multi-channel overload).

## Shape

```ts
notify.<channel>(
  to:      Notifiable | string,           // model OR raw route
  payload: NotificationChannels[channel], // typed per channel
  options?: SendOptions,
): Promise<void>
```

## Raw target — no model

Pass a string instead of a model to use the string as the route directly:

```ts
await notify.mail("guest@example.com", { subject: "Receipt", html: "<p>…</p>" });
await notify.whatsapp("+201234567890", { body: "Promo: 20% off!" }); // Phase 2
```

When the recipient isn't a model, `PreferenceProvider` and `RateLimiter` are skipped — there's no `Notifiable` to consult.

## Runtime-dynamic channel name

When the channel isn't a literal, use `notify.channel(name).send(...)`:

```ts
const channelName = await chooseChannelForUser(user);
await notify.channel(channelName).send(user, payload);
```

This is the only path with `unknown`-typed payloads — prefer the literal `notify.<channel>` when you can. `to` is still what decides the recipient: even for the `database` channel, a `recipientId`-shaped key on `payload` (or the model's physical recipient column name) is stripped before the row is built, so an untyped payload assembled from request JSON can't redirect the write to another recipient — see the `createFor` write-side section of the `use-in-app` topic.

## Opt into preference/rate-limit gating

Ad-hoc sends bypass the preference gate unless a notification `type` is known. Two ways to provide it:

```ts
// 1. Explicit — wins regardless of payload.
await notify.mail(user, payload, { type: "marketing.weekly" });

// 2. Auto-detected — database payloads carry their own `type` field.
await notify.database(user, { type: "welcome", title: "Welcome!" });
//                            ^^^^^^^^^^^^^^^ used for gating
```

`SendOptions.force === true` bypasses preferences. `RateLimiter` is consulted whenever a type is known (regardless of `force`).

## Custom channels

After registering a custom channel (see the `define-channel` topic), it's first-class:

```ts
await notify.discord(user, { content: "Build finished 🎉" });
await notify.slack(staff, { text: "Deploy starting" });
```

## SendOptions (3rd arg)

| Field            | Effect                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `delay`          | Reserved for `.queue` paths; not used by `notify.<channel>` (sync). |
| `locale`         | Forwarded to the channel's `send({ options })`.                     |
| `meta`           | Forwarded to the channel + included in every observability event.   |
| `idempotencyKey` | Injected into the database payload (dedupe).                        |
| `force`          | Bypass `PreferenceProvider`. Does NOT bypass `RateLimiter`.         |
| `type`           | Notification type for gating (ad-hoc only).                         |

## Failure surfaces

`notify.<channel>` rejects on configuration errors (`ChannelNotFoundError`) — those are loud, immediate, and don't fire a `failed` event. Channel-level send failures rethrow AND fire a `failed` event with the channel + error.

## See also

- The `notifications-basics` topic — front door + mental model.
- The `define-notification` topic — reusable multi-channel.
- The `define-channel` topic — register a custom channel.
- The `observe-notifications` topic — `sending` / `sent` / `failed` / `skipped` events.
