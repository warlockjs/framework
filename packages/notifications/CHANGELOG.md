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

- Shipped Warlock.js Notifications Package.
