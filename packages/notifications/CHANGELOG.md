# Changelog — @warlock.js/notifications

All notable changes to `@warlock.js/notifications` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.11

### Changed

- In-app column mapping moved onto the model as `static columnMap` (`recipient` / `tenant` / `readAt` / `isRead`); accessors, the repository, the `database` channel, and `notificationColumns` all derive from it. New exported `NotificationColumnMap` type.
- Read-state is presence-based: declaring `readAt`, `isRead`, or both selects the representation; omitting both defaults to a `read_at` timestamp. The mode-agnostic `unread` filter replaces the `isRead` filter key.
- Multi-tenant support: when the model declares a `tenant` column, the `database` channel reads it off the recipient and `createFor(recipientId, input, tenantId?)` writes it.
- `inApp.list` / `inApp.listUnread` now forward full list options (`page` / `limit` / `orderBy` + filters), not just filter keys.
- `notificationColumns(model)` derives recipient / tenant / read-state columns from `columnMap`; the SQL-vs-MongoDB `dataSource` branch is removed.

## 4.2.0

### New

- Shipped Warlock.js Notifications Package.
