---
title: "API reference"
description: Every public export of @warlock.js/notifications.
sidebar:
  label: "API reference"
---

## Dispatch

### `defineNotification<Data>(def): DefinedNotification<Data>`

`def`: `{ type: string; via: ChannelName[] | (data, to) => ChannelName[]; [channel]?: (data, to, ctx) => Payload }`.
Returns `{ send(to, data, options?), queue(to, data, options?), only(...channels) }`. `to` is a `Notifiable | Notifiable[]`. Throws `MissingRendererError` at definition time if a static `via` channel lacks a renderer.

### `notify`

A proxy. `notify.<channel>(to, payload, options?)` — `to` is `Notifiable | string`. `notify.channel(name).send(to, payload, options?)` for runtime-dynamic names. Rejects `ChannelNotFoundError` / `UnresolvableRouteError`.

### `defineChannel<P>(channel): Channel<P>`

Identity helper that types a custom channel's `send` against payload `P`.

### `notifications`

`on(event, handler) => () => void` and `off(event, handler)`. Events: `"sending" | "sent" | "failed" | "skipped"` (see `NotificationEvents`).

## Channels

- `mailChannel(config?: { from?; route? }): Channel<MailPayload>` — wraps core `sendMail`.
- `databaseChannel(repo): Channel<DatabasePayload>` — returned by `inApp.configure`; not constructed directly.

## In-app

### `inApp`

- `configure(options): Channel` — `options` is `{ model } | { repository }` (mutually exclusive). Binds the store + returns the `database` channel.
- `list(recipient, options?)` / `listUnread(recipient, options?)` — `options` carries paging (`page` / `limit` / `orderBy`) + filters (`type`, `unread`, …).
- `countUnread(recipient)` — cached.
- `find(recipient, id)`
- `markAsRead(recipient, id?)` / `markAsUnread(recipient, id?)`
- `dismiss(recipient, id?)`

`recipient` is a `Notifiable | Id`. All methods are recipient-scoped.

### `DatabaseNotification`

Abstract base model implementing `NotificationContract` (`recipientId` / `type` / `isRead` / `readAt` / `markRead()`, plus a `tenantId` getter) — all derived from `static columnMap`. Extend it for your `Notification` model.

### `BaseNotificationsRepository<TModel>`

Concrete repo. Resolves the model's `columnMap` in its constructor and derives BOTH the read filter (`filterBy`) and the write/update/delete mapping from it — one source, reads and writes can't disagree. Methods: `createFor(recipientId, input, tenantId?)`, `createManyFor`, `markRead`, `markUnread`, `findFor`, `deleteFor`. Subclass only for EXTRA query methods; column names come from the model's `columnMap`.

## Migration

`notificationColumns(model?): ColumnMap` — table columns named from the model's `columnMap` (recipient / tenant / read-state); `type` / `title` / `body` / `payload` / `idempotency_key` are fixed, with a unique `idempotency_key`. Use with `Migration.create`.

## Config

The app path is **declarative**: `src/config/notifications.ts` exports a `NotificationConfig` as default, and the notifications connector registers it at boot. `setNotificationConfig(config)` / `getNotificationConfig()` / `resetNotificationConfig()` are the underlying functions (the connector calls `setNotificationConfig`; tests use `reset`).

`NotificationConfig`: `{ channels: ChannelMap; queue?; preferences?; rateLimit? }`.

## Contracts

- `Channel<P>` — `{ name; route?; send }`.
- `NotificationContract` — the stored-record shape.
- `PreferenceProvider` — `resolveChannels(notifiable, type, requested) => ChannelName[]`.
- `RateLimiter` — `allow(notifiable, channel, type) => boolean`.
- `QueueDispatcher` — `dispatch(job) => Promise<void>`.

## Types

- `Notifiable` (= cascade `Model`), `Id` (`string | number`).
- `NotificationChannels` — the declaration-merge channel→payload registry.
- `NotificationColumnMap` — `{ recipient?; tenant?; readAt?; isRead? }`, the model's `columnMap` shape.
- `ChannelName`, `MailPayload`, `DatabasePayload`, `NotificationInput`.
- `SendOptions` — `{ delay?; locale?; meta?; idempotencyKey?; force?; type? }`.
- `RenderContext` — `{ locale?; meta? }` (the renderer's 3rd arg).
- `NotificationEvents` — `{ sending; sent; failed; skipped }` payloads. Every event carries `dispatchId` (shared by `sending` and its terminal `sent`/`failed`) + `notifiable?`; `sent`/`failed` also carry `durationMs`.

## Errors

`NotificationsNotConfiguredError`, `ChannelNotFoundError`, `NoQueueDispatcherError`, `MissingRendererError`, `UnresolvableRouteError`.
