---
description: 'Multi-channel notifications for Warlock: define once, send by mail, in-app database, or custom channels. Exports `defineNotification`, `notify`, `defineChannel`, `mailChannel`, `inApp`, `notificationColumns`, `notifications`, `bullmqQueue`, `heraldQueue`, `NotificationConfig`. Use for: "notify a user", "send order shipped by email and in-app", "unread notifications", "add a Slack or webhook channel", "queue notification delivery". Not this package: sending a plain email or mail templates → @warlock.js/core sendMail; background jobs → @warlock.js/queue.'
---

# @warlock.js/notifications

An orchestrator over transports that already exist: one event, many recipients, any mix of channels, one render per channel. It is not a queue, template engine, or transport. `defineNotification` builds a reusable notification (`send`, `queue`, `only`); `notify.<channel>` does ad-hoc single-channel sends; `inApp` is the read side of the database channel. Server-only.

## The 80% path

1. Orient with `notifications-basics.md`.
2. Configure channels in `src/config/notifications.ts`: `configure-notifications.md`; create the table: `write-notification-migration.md`.
3. Define the notification with `via` and a renderer per channel: `define-notification.md`; one-off sends: `send-ad-hoc.md`.
4. Serve the inbox (list, mark read): `use-in-app.md`.
5. Custom channel: `define-channel.md`; deferred delivery: `queue-notifications.md`; sent/failed/skipped hooks: `observe-notifications.md`.

## Conventions and pitfalls

- The config is declarative; the connector registers its default export, so never call `setNotificationConfig` yourself.
- Channel names are typed through `NotificationChannels` declaration merging.
- `mailChannel` wraps core `sendMail`; use core directly for non-notification mail.
- Every send accepts `force` and `idempotencyKey`; preferences and rate limits are pluggable gates.
- `.queue()` needs a backend: `bullmqQueue` (with `@warlock.js/queue`) or `heraldQueue`.
- Do not value-import from client code.
