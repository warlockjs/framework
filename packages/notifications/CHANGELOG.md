# Changelog — @warlock.js/notifications

All notable changes to `@warlock.js/notifications` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## Unreleased

### Security

- `BaseNotificationsRepository.createFor` no longer lets the channel payload override server-owned row keys. The payload was spread after the trusted `recipientId`, so an untyped caller (e.g. a payload assembled from request JSON, or `notify.channel(name).send`) carrying a `recipientId` key — or the model's physical recipient column name — could write the notification into another recipient's inbox, contradicting the recipient-scoping guarantee. Server-owned keys (`id`, `recipientId`, `tenant`, `readAt`, `isRead`, and their resolved physical columns) are now stripped from the payload at runtime and the trusted arguments are applied last; legitimate fields (`type`, `title`, `body`, `payload`, `idempotencyKey`) pass through unchanged. `createManyFor` inherits the fix.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.2.11

### Changed

- In-app column mapping moved onto the model as `static columnMap` (`recipient` / `tenant` / `readAt` / `isRead`); accessors, repository, and channels all derive from it. New `NotificationColumnMap` type.
- Read-state is presence-based — declaring `readAt`, `isRead`, or both selects the representation (default `read_at`); the mode-agnostic `unread` filter replaces `isRead`.
- Multi-tenant support — when the model declares a `tenant` column, the `database` channel reads it off the recipient and `createFor(...)` writes it.
- `inApp.list` / `inApp.listUnread` now forward full list options (`page` / `limit` / `orderBy` + filters).
- `notificationColumns(model)` derives its columns from `columnMap`; the SQL-vs-MongoDB `dataSource` branch is removed.

## 4.2.0

### New

- Shipped Warlock.js Notifications Package.
