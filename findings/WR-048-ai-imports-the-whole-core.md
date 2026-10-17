# WR-048 — `@warlock.js/ai` imports the whole Core root for one IP helper

- **Packages:** `@warlock.js/ai` 5.30.0 (`security/outbound-policy`, `security/private-ip`), `@warlock.js/core` 5.30.0
- **Classification:** packaging bug (same family as the earlier Core subpath request that shipped `@warlock.js/core/errors`)
- **Found:** 2026-10-17, while bundling a standalone agent runner process built on `@warlock.js/ai`.

## Observed

`ai`'s outbound-policy and private-IP modules import the `@warlock.js/core` root only for `isPrivateOrReservedIp`.
A standalone process (not a Warlock app) using `ai.agent` therefore pulls in Core's HTTP server, database,
cache and React-adjacent modules. The scoped budget stores also lazily import `@warlock.js/cache` and
`@warlock.js/cascade`.

## Request

- A side-effect-free Core subpath for the network helpers (e.g. `@warlock.js/core/net`), or a local copy of the
  helper in `ai`.
- Keep the cache and cascade imports lazy and optional (already the case), and document them as optional peers
  for standalone use.

## App workaround

The app's bundler aliases the Core root, inside `@warlock.js/ai` only, to Core's `storage/utils/classify-ip-address`
module, and keeps cache and cascade external.
