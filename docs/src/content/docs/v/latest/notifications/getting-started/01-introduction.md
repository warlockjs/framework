---
title: "Introduction"
description: What @warlock.js/notifications is, when to reach for it, and how it compares to hand-rolled mail calls and raw DB inserts.
sidebar:
  order: 1
  label: "Introduction"
---

Notifications is the layer between "an event happened" and "the user found out." You define a notification once — which channels it goes through, and how it renders on each — then fire it from anywhere with one call. The package handles fan-out across recipients, per-channel rendering, optional preference/rate-limit gating, and idempotency.

> **Not standalone.** It builds on `@warlock.js/core` for mail and `@warlock.js/cascade` for the in-app store. If you're already on Warlock, both are there.

## The whole thing in 15 lines

```ts
import { defineNotification, notify } from "@warlock.js/notifications";

const welcome = defineNotification<{ name: string }>({
  type: "welcome",
  via: ["mail", "database"],
  mail: ({ name }) => ({ subject: "Welcome!", html: `<p>Hi ${name}</p>` }),
  database: ({ name }) => ({ title: `Welcome, ${name}` }),
});

await welcome.send(user, { name: user.get("name") }); // mail + in-app row, one call

await notify.mail(user, { subject: "Ping", html: "<p>hi</p>" }); // ad-hoc, no definition
```

That's the entire surface for the common case. Everything else — preferences, rate limits, idempotency, custom channels, observability — is depth you opt into.

## What you get

- **One definition, every channel.** `defineNotification` renders a single payload per channel from the same data. Add a channel to `via` and write its renderer — the call site doesn't change.
- **A typed channel proxy.** `notify.<channel>(to, payload)` is payload-typed against a declaration-merge registry. A custom channel becomes `notify.discord(...)` after a 3-line `declare module`.
- **Recipient-scoped in-app reads.** `inApp.markAsRead(user, id)` can't flip another user's row — the recipient id is forced into every query. Security by construction, not by convention.
- **Pluggable gates.** A `PreferenceProvider` decides which channels a recipient accepts; a `RateLimiter` caps per-user volume. Both are optional config slots.
- **Retry-safe sends.** Pass an `idempotencyKey` and a retried send returns the existing row instead of inserting a duplicate.

## When to reach for it

| Use notifications | Use something else |
| --- | --- |
| Telling a user something across one+ channels | A single transactional email with no in-app trace — `sendMail` directly is fine |
| You want an in-app notification center (unread counts, mark-read) | Pure server-to-server events — use `@warlock.js/herald` |
| The same event renders differently on mail vs in-app vs push | A one-off log line — use `@warlock.js/logger` |
| Users can mute channels / you need per-user rate limits | Fire-and-forget with no preferences — still fine here, gates are optional |

## vs hand-rolled `sendMail` + DB inserts

Without this package, every "notify the user" path re-implements: render the email, call `sendMail`, insert an in-app row with the right columns, check the user's preferences, maybe rate-limit, handle the retry case. Notifications collapses that into a definition + a `send()`, and keeps the channel logic in one place instead of scattered across controllers.

## Next

- [Installation](./02-installation.mdx) — install + wire `config/notifications.ts`.
- [Your first notification](./03-your-first-notification.md) — model, migration, definition, send — end to end.
