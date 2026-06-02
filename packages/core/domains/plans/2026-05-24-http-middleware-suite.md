# 2026-05-24 — HTTP middleware suite

**Status:** in-progress
**Started:** 2026-05-24
**Context:**

- `@warlock.js/core/src/http/middleware/` — current floor: `cache-response-middleware.ts`, `inject-request-context.ts`, `index.ts`. Auth lives separately in `@warlock.js/auth/src/middleware/auth.middleware.ts` and is out of scope.
- `@warlock.js/core/src/http/server.ts:11` — global Fastify `bodyLimit` hardcoded at `200 * 1024 * 1024 * 1024` (200 GB). Memory-exhaustion footgun; rewire to read from config.
- `@warlock.js/core/src/http/plugins.ts:14` — `@fastify/rate-limit` registered globally from `http.rateLimit`. Per-route override layers on top, does not replace the plugin.
- `@warlock.js/core/src/http/types.ts` — `HttpConfigurations` has `rateLimit` but no `bodyLimit`, no `idempotency`, no `requestId`, no `maintenance`. Adds wired here.
- `@warlock.js/core/src/http/middleware/cache-response-middleware.ts` — `response.onSent(...)` pattern reused by idempotency to capture the response body for replay.
- `@warlock.js/core/src/http/types.ts:93` — `"throttled"` already exists as a `ResponseEvent` for 429. `concurrencyLimit` overflow reuses it.
- `@warlock.js/cache` — backing store for `idempotency`, `concurrencyLimit` (counter), `rateLimit` overrides if we ever swap stores.
- `@warlock.js/auth` — `request.user` populated by `authMiddleware`. `idempotency` must run **after** auth to scope keys per user.

## Why now

- 200 GB body limit is a one-line DoS — uploads via `@fastify/multipart` are capped at 10 MB, but JSON bodies are unbounded.
- AI-ops platform → duplicate POSTs on network retries trigger duplicate AI calls. Real money lost. Idempotency is the cheapest insurance we can ship.
- No request-id anchor → multi-service debugging is guesswork. Cheapest observability win in the framework.
- Global rate-limit is too blunt for login / OTP / password-reset / expensive AI endpoints.
- Concurrency cap absent — long-running endpoints (report gen, image processing, AI completions) have nothing between them and a thundering-herd.
- Maintenance + IP filter are small but high-leverage ops primitives every production app eventually wants.

## Primitives to ship

| Name                 | File                          | Shape                                                                  | Purpose                                              |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `rateLimit`          | `rate-limit.middleware.ts`    | `rateLimit({ max, duration, keyGenerator? })`                          | Per-route/group cap on top of global plugin.         |
| `maxBodySize`        | `max-body-size.middleware.ts` | `maxBodySize("2mb" \| number)`                                         | Per-route Content-Length cap; 413 on exceed.         |
| `concurrencyLimit`   | `concurrency-limit.middleware.ts` | `concurrencyLimit(n, { keyGenerator? })`                            | Cap in-flight requests; 429 + `Retry-After` on full. |
| `idempotency`        | `idempotency.middleware.ts`   | `idempotency({ ttl?, methods?, headerName? })`                         | Dedupe writes by `Idempotency-Key`; cached replay.   |
| `maintenance`        | `maintenance.middleware.ts`   | `maintenance({ allowlist?, retryAfter? })`                             | 503 + `Retry-After` when `http.maintenance.enabled`. |
| `ipFilter`           | `ip-filter.middleware.ts`     | `ipFilter({ allow?, deny? })`                                          | Allowlist/blocklist by client IP.                    |
| `requestId` (merged) | `inject-request-context.ts`   | Inline — no new file. Generates/inherits `X-Request-Id` per request.   | Observability anchor; attaches to `request.id`.      |

All ship from `@warlock.js/core` and re-export from `src/http/middleware/index.ts`. Same `(request, response) => ...` signature as `authMiddleware`.

## Design — per primitive

### `rateLimit({ max, duration, keyGenerator? })`

Reuses `@fastify/rate-limit`'s per-route config injection via `request.server.rateLimit`. **Replaces** the global cap for routes it touches (Fastify-idiomatic, not stacked). 429 + `Retry-After` on exceed. Default `keyGenerator` = client IP; override to scope per user.

```ts
router.post("/auth/login", login.controller, [rateLimit({ max: 5, duration: 60_000 })]);
```

### `maxBodySize(limit)`

Reads `Content-Length`. Rejects with 413 before body is parsed if exceeded. Limit accepts `"2mb"` / `"500kb"` / raw bytes. Note: Fastify also exposes per-route `bodyLimit` at registration; this middleware exists for symmetry with the rest of the suite and for cases where the limit needs to vary by request context (e.g. user tier).

```ts
router.post("/upload", upload.controller, [maxBodySize("2mb")]);
```

### `concurrencyLimit(n, { keyGenerator? })`

In-process counter keyed by route (or by `keyGenerator(request)`). Increments on entry, decrements via `response.onSent(...)`. Over-cap → 429 + `Retry-After: 1` immediately. No queue, no timeout (queueing in-memory is a footgun: lost on restart, unbounded under load).

```ts
router.post("/reports/generate", report.controller, [concurrencyLimit(3)]);
```

**Trade-off acknowledged:** in-process means N replicas = N × cap. If we ever need distributed concurrency, swap the counter for a `@warlock.js/cache` lock — same shape, different store. Out of scope here.

### `idempotency({ ttl?, methods?, headerName? })`

Reads `Idempotency-Key` header. Cache key = `idem:{userType}:{userId|ip}:{key}`. Body hashed (sha256) and stored alongside the cached response.

**Lifecycle:**

1. Missing header on eligible method → pass through (idempotency is opt-in by the client).
2. Hit + body matches → replay cached status + body; do not re-run handler.
3. Hit + body differs → 422 with `errorCode: IdempotencyKeyConflict`.
4. Miss → run handler; on `response.onSent(...)`, cache `{ status, body, bodyHash }` for `ttl` (default 24h).

**Eligible methods:** POST, PUT, PATCH, DELETE (default). GET/HEAD skipped.
**Header name:** `Idempotency-Key` (RFC draft-ietf-httpapi-idempotency-key), configurable.
**Backing store:** `@warlock.js/cache` (whatever driver is configured).
**Scope:** per-user when `request.user` set, per-IP fallback. → must run **after** `authMiddleware`.

```ts
router.post("/orders", createOrder.controller, [authMiddleware("client"), idempotency()]);
```

### `maintenance({ allowlist?, retryAfter? })`

Reads `http.maintenance.enabled` from runtime config. When true → 503 + `Retry-After`. `allowlist` (path prefixes or named routes) bypasses — defaults to `["/health", "/admin/*"]`. Designed to be flipped via config + restart, or via a future runtime-config primitive.

```ts
// Wired in warlock.config.ts > http.middleware.all
http: { middleware: { all: [maintenance({ allowlist: ["/health"] })] } }
```

### `ipFilter({ allow?, deny? })`

CIDR or exact-IP list. `allow` (if present) is exclusive; `deny` is additive. Reads from `request.ip` (Fastify already has `trustProxy: true`). 403 on block.

```ts
router.group({ prefix: "/admin" }, () => {
  router.use(ipFilter({ allow: ["10.0.0.0/8", "203.0.113.42"] }));
  router.get("/dashboard", dashboard.controller);
});
```

### `requestId` (merged into `inject-request-context.ts`)

Not a separate exported middleware. Inside `createRequestStore`:

- Read incoming `X-Request-Id`; if absent generate (`ulid()` or `crypto.randomUUID()` — TBD, see open items).
- Attach to `request.id`.
- Set on outgoing response header `X-Request-Id`.
- Pass into the context store so `log` channels can stamp every line.

Configurable via `http.requestId = { header?: "X-Request-Id", generator?: () => string, enabled?: true }`.

## Server.ts bodyLimit rewire

One-line change. `server.ts:11`:

```ts
bodyLimit: config.get("http.bodyLimit", 200 * 1024 * 1024 * 1024),
```

Default stays at 200 GB (per Hasan's call); consumers lower it via `src/config/http.ts > bodyLimit`. Add `bodyLimit?: number` to `HttpConfigurations` in `types.ts`.

## Tasks

### Code

- [x] Add `bodyLimit?`, `idempotency?`, `requestId?`, `maintenance?` fields to `HttpConfigurations` in `@warlock.js/core/src/http/types.ts`
- [x] Rewire `server.ts:11` `bodyLimit` to `config.get("http.bodyLimit", ...)`
- [x] Create `@warlock.js/core/src/http/middleware/rate-limit.middleware.ts`
- [x] Create `max-body-size.middleware.ts`
- [x] Create `concurrency-limit.middleware.ts`
- [x] Create `idempotency.middleware.ts` (+ helper `utils/idempotency-key.ts` for cache-key + body-hash)
- [x] Create `maintenance.middleware.ts`
- [x] Create `ip-filter.middleware.ts` (+ helper `utils/cidr-match.ts`)
- [x] Merge `requestId` inherit logic into `Request.setRequest()`; echo logic into `inject-request-context.ts` (no new file)
- [x] Re-export all from `src/http/middleware/index.ts`
- [x] Add `HttpErrorCodes` enum at `src/http/error-codes.ts` (Idempotency / RateLimit / Concurrency / BodyTooLarge / IpForbidden / Maintenance)
- [x] `tsc --noEmit` passes clean for `@warlock.js/core` AND `@warlock.js/auth` (consumer)

### Tests (Vitest, colocated `*.spec.ts`)

Deferred — tests are a follow-up commit. Code is ship-stable (typechecks, no behavior changes to existing routes) but unit coverage hasn't been written. Recommend a single test commit covering all seven primitives.

- [ ] `rate-limit.middleware.spec.ts` — over-cap returns 429
- [ ] `max-body-size.middleware.spec.ts` — over-cap returns 413; under-cap passes
- [ ] `concurrency-limit.middleware.spec.ts` — N+1th concurrent request rejected; counter decrements on completion + error paths
- [ ] `idempotency.middleware.spec.ts` — miss runs handler; hit-same-body replays; hit-different-body returns 422; missing header passes through; non-eligible methods skipped
- [ ] `maintenance.middleware.spec.ts` — 503 when enabled; allowlist bypass
- [ ] `ip-filter.middleware.spec.ts` — allow + deny precedence; CIDR + exact match
- [ ] `request-id` smoke test — header echoed; inherited from incoming; rejected when malformed

### Skills + docs (lockstep, per project rule)

- [x] Extend `@warlock.js/core/skills/write-middleware/SKILL.md` — built-in middleware catalog + request-id correlation section
- [x] Extend `domains/core/docs/guides/middleware.md` — "Built-in middleware" + "Request ID correlation" sections
- [x] Add tip-callout to `domains/core/docs/recipes/rate-limiting.md` pointing at the new built-in
- [ ] Add `domains/core/docs/recipes/protect-an-endpoint.md` — composes `rateLimit + idempotency + maxBodySize + authMiddleware`. **Deferred** — substantial new recipe page.
- [ ] Add `domains/core/docs/reference/http-middleware.md` — full per-primitive reference. **Deferred** — `reference/` subfolder doesn't exist yet; opens its own design question.
- [x] Update `domains/core/README.md` status section
- [ ] Regenerate `llms.txt` + `llms-full.txt`. **Deferred** until the recipe + reference pages land (otherwise we'd regenerate twice).

### Decisions log

- [x] Create `domains/core/design/decisions.md` with the entry: "HTTP middleware suite — primitives, semantics, why no throttle/queue, why per-user idempotency scope, why fail-closed IP filter."

## Open items

1. **`requestId` generator default — `ulid` vs `crypto.randomUUID`.** Recommend **`crypto.randomUUID`** (zero-dep, native, sortable enough for logs). Tradeoff: not lexically time-sortable like ULID. Defer to Hasan.
2. **Idempotency cache TTL default.** Recommend **24h**. Tradeoff: longer = more cache pressure + longer replay window; shorter = retries past TTL silently double-charge. 24h matches Stripe's spec.
3. **Idempotency body-hash inclusion.** Recommend **hash full body**. Tradeoff: small CPU cost on every eligible write, but only way to detect key reuse with different intent. Alternative: trust the key, skip hash — faster but unsafe.
4. **`maintenance` toggle source — config-file flag vs runtime-mutable.** Recommend **config flag for now** (`http.maintenance.enabled`), requires app restart. Tradeoff: ops needs a deploy/restart cycle to flip; runtime-mutable needs a primitive we don't have yet (config hot-reload). Defer runtime-mutable to a separate plan.
5. **`concurrencyLimit` — counter location.** Module-scoped `Map<key, count>` lives for the process lifetime. Recommend **yes, accept process-local semantics**. Tradeoff: N replicas → N × cap. Documented as "per-instance"; distributed variant is future scope.
6. **`ipFilter` — what to do when `request.ip` is empty/unparseable?** Recommend **deny by default** (fail-closed). Tradeoff: edge cases (Unix socket, internal calls) need explicit allow rules. Safer default.
7. **`idempotency` — what if user supplies header on a GET?** Recommend **ignore silently** (header is no-op on non-eligible methods). Tradeoff: client expecting strict 400 won't get one. Matches Stripe.

## Summary

**Code shipped 2026-05-24.** Seven primitives plus the request-id correlation pattern landed in `@warlock.js/core`:

- **New files:** `error-codes.ts`, six `*.middleware.ts` files, three `middleware/utils/*.ts` helpers.
- **Edits:** `http/types.ts` (config surface), `http/server.ts` (config-driven `bodyLimit`), `http/request.ts` (`X-Request-Id` inherit + validation), `http/middleware/inject-request-context.ts` (`X-Request-Id` echo), `http/index.ts` + `http/middleware/index.ts` (namespace assembly), `skills/write-middleware/SKILL.md` (catalog + request-id section + namespace pattern), `domains/core/docs/guides/middleware.md` + `recipes/rate-limiting.md`.
- **Decisions log opened** at `domains/core/design/decisions.md` (two entries: middleware semantics + public-API namespace pattern).
- **Typecheck:** `tsc --noEmit` clean for `@warlock.js/core` and `@warlock.js/auth`.

**Naming evolution mid-implementation.** Originally the design above shows bare factory exports (`rateLimit`, `idempotency`, …). After implementation, we converged on a single `middleware` namespace object as the public API surface (`middleware.rateLimit`, `middleware.idempotency`, …). The internal factory functions kept the `*Middleware` suffix (`rateLimitMiddleware`, etc.) for in-package code organization; bare names are not exported. Rationale: discoverability via single autocomplete entry point, no namespace collision with config keys (`http.rateLimit`, `http.idempotency`, `http.maintenance`). `cacheMiddleware` moved to `middleware.cache` in the same cycle — no deprecation alias since the framework is pre-1.0 and the function had no external consumers. The code blocks in the design section above remain as written for historical reference; the live API is `middleware.X`. See `domains/core/design/decisions.md` for the full rationale.

**Skill split.** Catalog + per-primitive deep-dives + request-id correlation moved out of `write-middleware` into a new sibling skill `use-middleware`. `write-middleware` now focuses purely on **authoring** custom middleware. Two different agent intents, two skills. Naming matches existing `use-X` pattern.

**i18n keys flattened.** `t("http.errors.X")` → `t("http.X")` across all seven middlewares to match the validation group's flat-key convention. New `http` group added to the `create-warlock` template's `locales.ts` (sibling to `validation`). The project's own `locales.ts` was NOT touched — separate decision.

**Response helper migration (linter-led).** `rateLimit`, `concurrencyLimit`, and `maxBodySize` migrated from `response.send({...}, 429/413)` to dedicated helpers: `response.tooManyRequests()` and `response.contentTooLarge()` (newly added to `Response` class). `ResponseEvent` types gained `contentTooLarge`. Code reads cleaner; HTTP semantic is implicit in the helper name.

**Still open:** unit tests (deferred to a follow-up commit), full reference docs (`reference/http-middleware.md` deferred — needs a `reference/` subfolder design decision), `protect-an-endpoint` recipe (deferred), `llms.txt` regen (paired with the deferred docs), project-instance `locales.ts` update (deferred per scope).
