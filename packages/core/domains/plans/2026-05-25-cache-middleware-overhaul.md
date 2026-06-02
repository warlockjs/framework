# 2026-05-25 — Cache response middleware overhaul

**Status:** not-started
**Started:** —
**Context:**

- `@warlock.js/core/src/http/middleware/cache-response-middleware.ts` — current implementation; ~115 lines; predates the namespace + idempotency-pattern work shipped 2026-05-24.
- `@warlock.js/core/src/http/middleware/idempotency.middleware.ts` — sibling primitive shipped 2026-05-24; pattern reference for cached-replay correctness (status preserved, replay header, helper-based send, body-hash conflict detection).
- `@warlock.js/core/skills/use-middleware/SKILL.md` — currently documents `middleware.cache(opts)` as the public surface.
- `@warlock.js/cache` skill + subskills (`lock.md`, `swr.md`, `set-options.md`) — exposes `remember()`, locks, tags, SWR; the cache middleware uses none of these today.
- `domains/core/design/decisions.md` — namespace + naming decisions for built-in middleware (2026-05-24 entries).
- This session's deep-senior review surfaced 22 issues: one bug, four design gaps, three footguns, several cleanups.

## Why now

- **Lurking bug.** Middleware returns `FastifyReply` instead of `Response`; framework re-enters `Response.send(FastifyReply)` which silently no-ops on Fastify's `reply.sent` guard. Works by accident — one Fastify version bump from regression. Plus the double-pipeline runs all the framework events on cache hits (the path that's supposed to be fast).
- **No stampede protection.** N concurrent requests on a cold cache → handler runs N times. Direct money loss on expensive endpoints (AI calls, aggregations). `@warlock.js/cache.remember()` exists for exactly this; middleware doesn't use it.
- **Lost response metadata.** Status / custom headers / content-type all dropped on replay. 201 Created replays as 200. XML responses come back as JSON-shaped. Only JSON-200 GET endpoints work correctly.
- **No invalidation beyond TTL.** Tag-based invalidation is a 1-property add. Without it the middleware is a toy in any non-trivial app.
- **Inconsistent with idempotency.** Same problem shape (cache + replay) shipped two different solutions in the same package; idempotency is the better pattern. Close the drift before consumers ossify usage.
- **Three stale TODOs at the top of the file** — pure debt signal.

## Design

Single rewrite. Mirrors `idempotency.middleware.ts` shape.

`ttl` follows the cache package's `CacheTtl` shape — `number` (seconds), `string` (human-readable: `"1h"`, `"30m"`, `"7d"`, parsed via `ms`), or `Infinity` (no expiration). Imported directly from `@warlock.js/cache` so we track the cache package's source of truth.

```ts
import type { CacheTtl } from "@warlock.js/cache";

export type CacheResponseOptions = {
  cacheKey: string | ((request: Request) => string | Promise<string>);
  ttl?: CacheTtl;           // defaults to http.cache.ttl, then "5m"
  tags?: string[];          // forwarded to cache.set for tag-invalidation
  driver?: string;          // defaults to http.cache.driver, then default driver
  headerName?: string | false;  // defaults "X-Cache"; set false to disable
  withLocale?: boolean;     // defaults FALSE (was true — breaking)
  transform?: (body: unknown, request: Request) => unknown | Promise<unknown>;
  shouldCache?: (request: Request, response: Response) => boolean;
  omit?: string[];          // thin shim over transform; kept for ergonomics
};

type CachedResponse = {
  status: number;
  body: unknown;
  contentType?: string;
};
```

Lifecycle:

1. Resolve `cacheKey` (await if function); append `:<locale>` only when `withLocale`.
2. `cache.remember(key, ttl, runOnceAcrossConcurrentWaiters)` — stampede-safe.
3. **HIT** → `response.setStatusCode(cached.status).header("Content-Type", cached.contentType).header("X-Cache", "HIT").send(cached.body)`. Returns the warlock `Response` → framework recognizes via `instanceof Response`, no double-send.
4. **MISS** → set `X-Cache: MISS`; handler runs under `remember`'s lock. On `response.onSent`: skip if `shouldCache(req, res) === false` OR status ≥ 500. Otherwise capture `{ status, body, contentType }`, apply `transform`/`omit`, `cache.set(key, ..., { ttl, tags })`.

**Bug fix**: replay uses `response.send` (returns `Response`), not `response.baseResponse.send` (returns `FastifyReply`).

**Files touched:**
- `cache-response-middleware.ts` — rewrite. Rename function to `cacheResponseMiddleware` (internal). Rename namespace prop from `middleware.cache` to `middleware.cacheResponse` (see open item #1).
- `utils/cache-key.ts` — new helper; clone-safe key resolution + locale append.
- `http/types.ts` — add `http.cache` config block (`ttl`, `driver`, `headerName` defaults).
- `middleware/index.ts` — update type re-export (`CacheMiddlewareOptions` → `CacheResponseOptions`).
- `middleware/middleware-list.ts` — namespace property rename.

## Tasks

### Code

- [ ] Rewrite `cache-response-middleware.ts` with the lifecycle above.
- [ ] Drop the string-only factory form (`middleware.cacheResponse("key")`) — always object.
- [ ] Default `withLocale: false`.
- [ ] Default `omit: []`; document `transform` as the cleaner sanitization path.
- [ ] Add `utils/cache-key.ts` (resolve + locale append, no caller mutation).
- [ ] Add `http.cache` to `HttpConfigurations` (`ttl?`, `driver?`, `headerName?`).
- [ ] Document the `request.path` guard on the `onSent` callback (one-line comment).
- [ ] Drop the three stale TODOs at file head.
- [ ] Rename: internal `cacheMiddleware` → `cacheResponseMiddleware`; namespace `middleware.cache` → `middleware.cacheResponse` (pending #1).

### Tests (Vitest, colocated `*.spec.ts`)

**Not deferred this time** — rewrite changes behavior (status preservation, stampede protection); tests are the only verification.

- [ ] HIT replays cached body + status + content-type; handler does NOT re-run.
- [ ] MISS runs handler; cache populated on `onSent` with correct shape.
- [ ] Stampede: 10 concurrent requests on cold cache → handler runs exactly once.
- [ ] `shouldCache(req, res) => false` skips the write.
- [ ] `transform` mutates cached body but not wire body.
- [ ] `tags: ["products"]` written; `cache.invalidateTag("products")` drops the entry.
- [ ] `withLocale: true` produces per-locale keys; `false` (new default) does not.
- [ ] Failure modes: handler throws → no cache write; 5xx response → no cache write; 4xx response → cache write (deterministic outcome).
- [ ] `X-Cache: HIT|MISS` set on both paths; suppressed when `headerName: false`.
- [ ] `omit: ["user"]` strips the field on replay.
- [ ] Same-key concurrent-different-body requests do NOT cross-pollute (single lock, single write).

### Skills + docs (lockstep, per project rule)

- [ ] Update `@warlock.js/core/skills/use-middleware/SKILL.md` — replace the brief `middleware.cache` mention with a real section: lifecycle, options, stampede note, tag invalidation, transform pattern, `X-Cache` header semantics.
- [ ] Update `domains/core/docs/guides/middleware.md` catalog table (`middleware.cache` → `middleware.cacheResponse`).
- [ ] Add `domains/core/docs/recipes/cache-an-expensive-endpoint.md` — walks ttl picking, tag invalidation, transform for sensitive fields, stampede behavior, when NOT to use it.
- [ ] Append entry to `domains/core/design/decisions.md` — "Cache response middleware overhaul: stampede protection, metadata preservation, tag invalidation, rename to cacheResponse."
- [ ] Regenerate `llms.txt` + `llms-full.txt` (paired with the deferred HTTP suite docs from 2026-05-24 plan).

## Open items

1. **Rename `middleware.cache` → `middleware.cacheResponse`?** Recommend **yes**. Reason: the `cache` singleton from `@warlock.js/cache` is also called `cache`, which is what people mentally parse when they see `middleware.cache(...)`. `cacheResponse` is explicit. Tradeoff: more keystrokes; minor breaking change vs the just-shipped `middleware.cache`. Mitigation: blast radius is small — shipped yesterday, no real consumers yet.

2. **`http.cache` config block — add or skip?** Recommend **add**: `{ ttl?: CacheTtl = "5m", driver?: string, headerName?: string | false = "X-Cache" }`. Reason: matches `http.idempotency` and `http.maintenance` patterns shipped yesterday; ops tune one knob. `CacheTtl` is re-exported from `@warlock.js/cache` so consumers get the same `number | string` accepted shape as `cache.set` itself. Tradeoff: more config surface, but consistent.

3. **Predicate name — `shouldCache` vs `if` vs `when`?** Recommend **`shouldCache`**. Reason: matches `retry`'s `shouldRetry`. Tradeoff: reads slightly awkwardly when the predicate returns `false` (`shouldCache: () => false` parses as "this should cache" + "false"). But the alternative names are worse.

4. **`transform` timing — before send or after `onSent`?** Recommend **after `onSent`, before `cache.set`**. Reason: don't slow the wire response with redaction work. Tradeoff: if `transform` is heavy, the `onSent` callback gets slow — but the client already has its response.

5. **Keep `omit` shim or force `transform`?** Recommend **keep `omit` as a documented shim** (`omit: ["user"]` → `transform: (body) => except(body, ["user"])`). Reason: 90% of caching jobs need exactly this; forcing a function for the trivial case is unfriendly. Tradeoff: two ways to do the simple case.

6. **Path guard on `onSent`** (current line 103: `response.request.path !== request.path`) — keep or drop? Recommend **keep with a comment**. The guard defends against path rewrites; cheap; preserves the original author's intent. Tradeoff: still feels defensive-paranoid without proof of a real case; could drop if grep finds no rewrite paths in the codebase.

7. **Async `cacheKey` resolution running on every request (including hits)** — fix or document? Recommend **document only**. Reason: fixing requires double-computing the key (once to check cache, once to fall back to async). Documentation that says "keep `cacheKey` functions sync or trivial" is cheaper. Tradeoff: developers might add slow async logic and discover the perf hit only under load.

## Summary

(Updated on completion.)
