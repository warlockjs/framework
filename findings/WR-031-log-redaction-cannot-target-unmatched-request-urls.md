# WR-031 — Log redaction cannot target sensitive URLs that per-route `logging` does not reach

- **Packages:** `@warlock.js/logger` 5.30.0 (redaction `censor`), `@warlock.js/core` 5.30.0 (route `logging`, `RequestLogSnapshot`)
- **Classification:** feature request
- **Found:** 2026-10-16, while moving an app's private-route log censor onto the 5.30 per-route
  `logging: { body: false, query: false }` option.

## Expected

An app can keep request bodies and queries for a family of private paths out of every log entry,
including requests that never matched a route (404s, encoded aliases such as `%2F` variants,
trailing-slash forms) and entries other code writes with the request snapshot as context.

## Observed

- Per-route `logging` (and `http.logging` defaults) apply only once a route has matched, so an
  unmatched or aliased request to a private path still logs its snapshot under the global policy.
- The logger's redaction `censor(value, path)` receives the whole `context` value at path
  `"context"`. To decide whether to strip it, the censor has to inspect `context.request.url` and
  `context.request.route` itself, then replace the whole context. There is no predicate form such as
  "redact `context.request.body` when `context.request.url` matches X".
- 5.30 changed the shape of that context to a `RequestLogSnapshot`. Censors written against 5.29
  (`context.request.route.path`, `context.request.baseRequest.url`) silently stop matching, because
  the fields are now `undefined`, and log entries are no longer censored. The upgrade notes list the
  break for custom channels, but not for redaction censors.

## Requests

- A path-prefix or matcher policy in `http.logging`, for example
  `http.logging.private: [{ path: /^\/api\/v2\/(api-runs|terminals)\b/, body: false, query: false }]`,
  applied to the decoded, normalized URL before route matching, so unmatched and aliased requests are covered.
- Or a structured redaction rule in the logger: `redact: [{ when: (entry) => …, paths: ["context.request.body"] }]`.
- Add "redaction censors that read `context.request`" to the 5.29 → 5.30 upgrade notes.

## Impact and workaround

The app now uses per-route `logging` on its private routes, and keeps a whole-`context` censor as
defence in depth. That censor reads `context.request.url` and `route` from the snapshot and covers
unmatched or aliased URLs.
