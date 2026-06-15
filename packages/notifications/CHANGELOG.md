# Changelog — @warlock.js/notifications

All notable changes to `@warlock.js/notifications` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

### Changed

- **In-app column mapping moved onto the model as `static columnMap`.** A notification model declares its physical columns once (`recipient` / `tenant` / `readAt` / `isRead`); `DatabaseNotification` accessors, `BaseNotificationsRepository` (read filter **and** write mapping), the `database` channel, and `notificationColumns` all derive from it — replacing the duplicated per-getter + `filterBy` column literals. New exported `NotificationColumnMap` type.
- **Read-state is presence-based.** Declaring `readAt`, `isRead`, or both selects the representation (timestamp / indexed boolean / both); omitting both defaults to a `read_at` timestamp. The mode-agnostic `unread` filter replaces the `isRead` filter key on `inApp` and the repository.
- **Multi-tenant support.** When the model declares a `tenant` column, the `database` channel reads the tenant value off the recipient and `createFor(recipientId, input, tenantId?)` writes it — no custom channel needed.
- `inApp.list` / `inApp.listUnread` now forward full list options (`page` / `limit` / `orderBy` + filters), not just filter keys.
- `notificationColumns(model)` names the recipient / tenant / read-state columns from `columnMap`; the SQL-vs-MongoDB `dataSource` branch is removed (declare the column names in `columnMap` instead).

## 4.2.0

### Added

- `defineNotification<Data>({ type, via, ...renderers })` — reusable multi-channel notifications with `.send` / `.queue` / `.only`; `(data, to, ctx)` renderers.
- `notify.<channel>(to, payload, options?)` — ad-hoc per-channel send proxy; `notify.channel(name)` runtime escape; raw-route targets.
- `defineChannel<P>({ name, route, send })` — custom channels; extend the `NotificationChannels` registry via `declare module`.
- `mailChannel(...)` — `mail` channel over core `sendMail`.
- `inApp.configure({ model } | { repository })` — binds the in-app store and returns the `database` channel.
- `inApp` read API — `list` / `listUnread` / `countUnread` / `find` / `markAsRead` / `markAsUnread` / `dismiss`, all recipient-scoped (IDOR-safe by construction).
- `DatabaseNotification` base model + concrete `BaseNotificationsRepository` with a `filterBy`-derived logical→physical column mapper covering read **and** write paths.
- `notificationColumns(Notification)` — driver-aware migration columns (snake_case PG/MySQL, camelCase MongoDB) with a unique `idempotency_key`.
- Idempotency — `createFor` find-or-creates on `idempotencyKey`, backed by a unique constraint with race re-fetch.
- `PreferenceProvider` + `RateLimiter` config slots (pre-send gates; `force` bypasses preferences only).
- `notifications.on("sent" | "failed" | "skipped", handler)` — typed event bus; handler exceptions logged, never break dispatch.
- `SendOptions` — `delay` (reserved; not honored yet — see Notes) / `locale` / `meta` / `idempotencyKey` / `force` / `type`.
- Async queue — `heraldQueue(...)` (`QueueDispatcher` backing `.queue()`) + `startNotificationsWorker(...)` consumer; both lazy-import `@warlock.js/herald`; jobs are pre-rendered + serializable.
- Errors — `NotificationsNotConfiguredError`, `ChannelNotFoundError`, `NoQueueDispatcherError`, `MissingRendererError`, `UnresolvableRouteError`.
- Eight skills covering the public surface (`notifications-basics` through `queue-notifications`).

### Notes

- Config errors (missing renderer, no queue dispatcher, unknown channel) reject `send`/`queue`; transport failures stay isolated as `failed` events. A static `via` with a missing renderer throws at definition time.
- Bridges-backed channels (`whatsapp` / `telegram` / `push` / `slack`), the `Channel.sendMany` bulk hook, delay-aware queue delivery + dead-letter handling, and the auto-wiring connector ship in a later release.
