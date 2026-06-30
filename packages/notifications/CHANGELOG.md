# Changelog — @warlock.js/notifications

All notable changes to `@warlock.js/notifications` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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
