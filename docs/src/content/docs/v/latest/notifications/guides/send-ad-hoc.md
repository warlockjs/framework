---
title: "Ad-hoc sends"
description: One-off, single-channel notifications via the notify.<channel> proxy and notify.channel(name).
sidebar:
  label: "Ad-hoc sends"
---

When you don't need a reusable definition, fire one channel directly:

```ts
import { notify } from "@warlock.js/notifications";

await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });
await notify.database(user, { type: "welcome", title: "Welcome!" });
```

`notify.<channel>` is a typed proxy — `payload` is checked against the channel's registry entry, and it works for any registered channel including custom ones. For **multi-channel** sends, use [`defineNotification`](./define-notification.md); there's no inline multi-channel form on purpose.

## Raw targets

Pass a string instead of a model to address it directly — no recipient lookup:

```ts
await notify.mail("guest@example.com", { subject: "Receipt", html: "…" });
```

## Runtime-dynamic channel

When the channel name isn't a compile-time literal:

```ts
const channel = await pickChannel(user);
await notify.channel(channel).send(user, payload);
```

## Opting into gating

Preference/rate-limit gates need a notification *type*. Ad-hoc sends provide it explicitly, or it's auto-detected from a database payload's `type`:

```ts
await notify.mail(user, payload, { type: "marketing.weekly" }); // explicit
await notify.database(user, { type: "welcome", title: "Hi" });   // auto-detected
```

Without a type, ad-hoc sends skip the preference gate (there's nothing to gate on). `force: true` bypasses preferences; rate limits always apply when a type is known.

## Errors

A send to an unregistered channel rejects with `ChannelNotFoundError` immediately. A channel whose `route()` returns `undefined` for the recipient rejects with `UnresolvableRouteError`.

## Next

- [Define a notification](./define-notification.md) — the reusable, multi-channel path.
- [Custom channels](./custom-channels.md) — make `notify.<yourChannel>` exist.
