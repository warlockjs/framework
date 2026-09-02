# Changelog — @warlock.js/logger

All notable changes to `@warlock.js/logger` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.2.2

- Documented: the README, CHANGELOG, and `overview` skill now describe the
  already-shipped `package.json` `"warlock": { "environment": "server" }`
  marker — `@warlock.js/logger`'s entire runtime surface is server-only. The
  marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

## 5.1.0

No changes to `@warlock.js/logger`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/logger`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/logger`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **Secrets are now redacted by default. This is a behavior change — logs that previously showed these values in cleartext will now show `[REDACTED]`.** Redaction used to be a *tool* (`redact.paths`, entirely opt-in): unless an application configured it, a `password` in `context`, an `authorization` header, or an `apiKey` on a logged `Error` reached every sink — console, log file, JSON log file, Sentry — verbatim. Protection existed only where every call site had been configured correctly, with no signal when one hadn't. It is now a *default*.

  A built-in denylist (`DEFAULT_REDACT_KEYS`) censors matching keys at any depth of `context`, `message`, and an `Error`'s own enumerable properties, applied at the same logger-wide choke point as `redact.paths` — so every channel inherits it, including custom ones. The set covers passwords, shared secrets, tokens (access/refresh/id/CSRF/session), API and private keys, HTTP credential headers (`authorization`, `x-api-key`, `cookie`, `set-cookie`), session IDs, connection strings, and high-sensitivity financial PII (card numbers, CVV, SSN, IBAN).

  Keys are matched **exactly**, after normalizing to lower-case with separators stripped — so one entry covers `apiKey` / `api_key` / `API-KEY` / `x-api-key`. Matching is deliberately not substring-based: `*token*` would also blank `tokenCount` and `passwordUpdatedAt`, which is silent data loss in the one place engineers look when something is broken. The trade is that unusual spellings are missed, which is what `redact.keys` is for.

  Two new knobs on `RedactConfig`, both usable logger-wide or per channel:

  - `keys: string[]` — extra key names, unioned with the built-in set.
  - `defaultKeys: false` — opt out of the built-in set entirely (restores the pre-4.15.0 behavior). An escape hatch, not a tuning knob; prefer a function `censor` if you need to keep a prefix.

  Existing `redact.paths` config is untouched and keeps working — paths and keys are independent matchers, and both apply. `paths` is now optional, so `redact: { keys: [...] }` alone is valid. The additive-only contract still holds in both directions: a channel can add keys or re-enable defaults, but **cannot** switch off a default the logger-wide config left on; conversely, a logger-wide `defaultKeys: false` is inherited rather than silently re-enabled by any channel that happens to set a `redact` option.

  Paths are evaluated before keys, so a function `censor` on an explicit path still receives the original value rather than a mask, and that leaf is not censored twice.

  Known residual gaps, unchanged by this release and documented on `applyRedact`: secrets interpolated into a `message` *string* (`` `token=${t}` ``) cannot be reached by either matcher; `Map` / `Set` / `Buffer` contents are not traversed; and properties exposed only via getters or non-enumerable descriptors are not walked, so an HTTP client that hides its request config behind a getter can still slip through. Enumerable ones — axios's `.config` / `.response`, which carry the outgoing `Authorization` header — *are* now covered.

### Fixed

- Cloning a log entry for redaction no longer discards an `Error`'s own enumerable properties. Previously, configuring `redact` at all silently reduced every logged `Error` to `message` / `stack` / `name` — dropping `.code` and friends as an unadvertised side effect, and putting `.config.headers.authorization` permanently out of reach of any path pattern. Those properties are now carried through the clone (and censored by the key denylist above). An `Error` subclass whose constructor takes a non-string argument also keeps its `message` instead of being rebuilt as an empty one.
- The redaction clone no longer expands buffers, typed arrays, `Map`, `Set`, `Promise`, or `RegExp` into plain objects — matching what the code already documented. A `Buffer` in `context` had been rebuilt as a multi-thousand-key index map.

### Dependencies

- Bumped `@mongez/reinforcements` to `^4.0.1`. The major makes `Random.string/nanoid/id/token/uuid` CSPRNG-backed (WebCrypto) and removes `Random.seed()` support. This package uses `Random.string(32)` only for the non-security `logger-<id>` instance identifier; audited for `Random.seed(` with no hits, so no code changes were needed.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.1

### Changed

- `captureAnyUnhandledRejection()` now exits the process non-zero after an `uncaughtException` (and prints the stack to `console.error` when no terminal channel is configured) so a fatal error at boot is never silently swallowed into a clean `exit 0` — opt out with `{ exitOnUncaughtException: false }` where the process recovers on its own (e.g. a dev server using HMR). `unhandledRejection` is unchanged (logged at `error`, never exits).

## 4.2.11

### Changed

- Bumped `@mongez/reinforcements` to 3.3.0

## 4.2.10

### Changed

- `ConsoleLog`'s timestamp (and the `↳` context arrow) switch from bright-black `gray` to the 256-color `slate` — recessive but cleanly legible where bright-black read muddy.

## 4.2.9

### Changed

- `ConsoleLog` output retuned for scannability — a time-only `HH:mm:ss.SSS` timestamp dimmed to gray, fixed-width level tags so the columns align, and `fatal` restored to a white-on-bright-red background badge. (`FileLog` / `JSONFileLog` keep the full ISO timestamp.)

## 4.2.8

### Changed

- `ConsoleLog` now prints each level's name beside its icon (`⚙ debug`, `ℹ info`, `⚠ warn`, `✗ error`, `✓ success`, `☠ fatal`) for at-a-glance reading.

## 4.2.0

### Added

- `log.flush()` — awaitable async counterpart to `flushSync()`, draining every channel via `Promise.allSettled` with per-channel isolation. Implemented by `FileLog` / `JSONFileLog`.
- `SentryLog` channel — forwards entries to Sentry (`eventLevels` become events, others breadcrumbs; `module` / `action` as tags). `@sentry/node` is an optional, lazily-imported peer.
- `log.fatal()` + `fatal` level — ranked strictly above `error` for unrecoverable failures; does not auto-flush or exit.
- `ConsoleLog` renders `fatal` with a `☠` icon on a bright-red background, distinct from `error`'s `✗`.

### Changed

- `captureAnyUnhandledRejection()` now escalates `uncaughtException` to `log.fatal` (was `error`); `unhandledRejection` stays at `error`.
- `LoggingData.type` is now typed as `LogLevel` (was a duplicated inline union).
- `LogContract` / `LogChannel` now expose an optional `flush?()` alongside `flushSync?()`.

### Fixed

- `@sentry/node` is referenced only via local types + an indirect dynamic import, so source-served consumers no longer get `TS2307: Cannot find module '@sentry/node'` when they don't install the optional peer.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
