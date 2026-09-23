# Changelog — @warlock.js/notifications

All notable changes to `@warlock.js/notifications` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.19.0

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.15.0 - 2026-09-18

### Removed

- The integration spec covering the deprecated `@warlock.js/queue/notifications` dispatcher, which was removed from `@warlock.js/queue` in this release. `bullmqQueue()` is the supported path and keeps its own coverage.

## 5.14.0 - 2026-09-17

### Added

- `bullmqQueue({ queue, attempts, backoff })`: a BullMQ-backed `.queue()` driver that lazy-loads `@warlock.js/queue` (optional peer); a missing package throws `QueuePackageNotInstalledError` naming `warlock add queue`.

## 5.13.0 - 2026-09-17

### Fixed

- Restored the portable `typecheck` script after Core's path-alias resolver was made safe for an absent first target.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

- Documented: the README, CHANGELOG, and `notifications-basics` skill now
  describe the already-shipped `package.json`
  `"warlock": { "environment": "server" }` marker —
  `@warlock.js/notifications`'s entire runtime surface is server-only. The
  marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

## 5.1.0

No changes to `@warlock.js/notifications`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/notifications`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/notifications`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

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
