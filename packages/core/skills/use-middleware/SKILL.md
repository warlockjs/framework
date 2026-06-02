---
name: use-middleware
description: 'Attach built-in HTTP middleware to routes via the `middleware` namespace from `@warlock.js/core` — rateLimit, concurrencyLimit, maxBodySize, idempotency, maintenance, ipFilter, cache. Plus `X-Request-Id` correlation, wired automatically. Triggers: `middleware.rateLimit`, `middleware.concurrencyLimit`, `middleware.maxBodySize`, `middleware.idempotency`, `middleware.maintenance`, `middleware.ipFilter`, `middleware.cache`, `X-Request-Id`, `Idempotency-Key`; "add rate limiting", "dedupe writes by idempotency key", "cap concurrent requests", "block IPs", "cache a GET response"; typical import `import { middleware } from "@warlock.js/core"`. Skip: author custom middleware — `@warlock.js/core/write-middleware/SKILL.md`; cache singleton — `@warlock.js/cache/cache-basics/SKILL.md`; competing libs `@fastify/rate-limit` direct, `express-rate-limit`, `helmet`.'
---

# Warlock — use built-in middleware

`@warlock.js/core` ships seven HTTP middlewares behind a single namespace object: `middleware`. They cover the patterns most apps reach for — rate limit, concurrency cap, body size cap, idempotency, maintenance mode, IP filter, response cache. Plus the request-id echo, which isn't a middleware but lives in the same mental category.

```ts
import { middleware } from "@warlock.js/core";

middleware.rateLimit({ max: 5, duration: 60_000 });
middleware.idempotency();
middleware.maxBodySize("2mb");
// ... etc
```

For authoring your OWN middleware (custom guards, enrichment, etc.), see [`write-middleware`](../write-middleware/SKILL.md).

## The catalog

All seven are factories — call them to get a `Middleware`. All set `errorCode` on the response so clients can branch without parsing error text (see `HttpErrorCodes` from `@warlock.js/core`). Error messages are translation-driven — keys live under the `http` group in `src/app/shared/utils/locales.ts`.

| Factory | What it does | Status on reject |
|---|---|---|
| `middleware.rateLimit({ max, duration })` | Per-route/group cap on top of global `@fastify/rate-limit` | 429 + `Retry-After` |
| `middleware.concurrencyLimit(n)` | Cap in-flight requests; no queue, fast reject | 429 + `Retry-After: 1` |
| `middleware.maxBodySize("2mb")` | Per-route `Content-Length` cap | 413 |
| `middleware.idempotency()` | Dedupe writes by `Idempotency-Key` header; cached replay | 422 on conflict |
| `middleware.maintenance()` | Globally toggle 503 with allowlist bypass | 503 + `Retry-After` |
| `middleware.ipFilter({ allow, deny })` | Allowlist/denylist by client IP | 403 (fail-closed) |
| `middleware.cache(opts)` | Cache + replay successful JSON responses | n/a |

Each is documented inline (JSDoc + `@example`) — read the file under `@warlock.js/core/src/http/middleware/<name>.middleware.ts` for the full option surface.

## `rateLimit` vs `concurrencyLimit`

- **Rate limit** caps **requests per time window** — 5 logins/minute per IP. Use for abuse prevention, cost-control on cheap-but-spammable endpoints.
- **Concurrency limit** caps **in-flight requests at any instant** — 3 simultaneous report generations. Use for expensive endpoints where parallel calls would overload the worker (CPU-bound, large memory, slow third-party).

Both counters are **process-local**. With N replicas the effective cap is N × value. For globally-shared rate limits, configure `@fastify/rate-limit` with a Redis store via `http.rateLimit` instead.

```ts
import { middleware } from "@warlock.js/core";

router.post("/ai/summarize", summarizeController, {
  middleware: [
    middleware.rateLimit({ max: 60, duration: 60 * 60 * 1000 }), // 60/hr per user
    middleware.concurrencyLimit(5),                              // ≤5 in-flight at once
  ],
});
```

## `idempotency` — must run after auth

The cache key is `idem:{userType}:{userId|ip}:{key}` so user A can't replay user B's key. That requires `request.user` to be populated, so order it **after** `authMiddleware`:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { middleware } from "@warlock.js/core";

router.post("/orders", createOrderController, {
  middleware: [authMiddleware("client"), middleware.idempotency()],
});
```

Lifecycle:

1. **Method not eligible** (GET / HEAD) → pass through.
2. **No `Idempotency-Key` header** → pass through (the primitive is opt-in by the client).
3. **Key + same body within TTL** (default 24h) → replays the cached response with `Idempotent-Replay: true`. Handler does NOT re-run.
4. **Key + different body** → 422 `IdempotencyKeyConflict`. Client bug — same key must mean same intent.
5. **Cache miss** → runs handler; on response sent, caches `{ status, body, bodyHash }` for TTL.

Server errors (5xx) are not cached — clients can retry past a 5xx. 4xx responses ARE cached (they're deterministic outcomes of the request).

**Client side, this only works if the client reuses the same key across retries.** Generate once at "intent to submit" time, persist it across the retry loop, drop it on confirmed success or final failure.

## `maxBodySize` vs the global `http.bodyLimit`

`http.bodyLimit` in config is read by Fastify at server-start and applies to every body. `middleware.maxBodySize()` is a per-route middleware on top — it checks `Content-Length` after route match and rejects with 413 before body parsing runs. Use both: global as a safety net, per-route for tight caps on small-payload endpoints.

```ts
// src/config/http.ts
export default { bodyLimit: 10 * 1024 * 1024 }; // 10MB globally

// src/app/comments/routes.ts
import { middleware } from "@warlock.js/core";

router.post("/comments", createCommentController, {
  middleware: [middleware.maxBodySize("8kb")], // comments shouldn't be larger
});
```

## `maintenance` is config-driven

Toggle via `http.maintenance.enabled` (and `http.maintenance.allowlist`, default `["/health"]`). Flipping the flag requires a process restart — there's no runtime hot-flip yet. Register at the app-level so every route is covered:

```ts
// src/config/http.ts
import { middleware } from "@warlock.js/core";

export default {
  maintenance: { enabled: env("MAINTENANCE_MODE") === "true" },
  middleware: {
    all: [middleware.maintenance({ allowlist: ["/health", "/admin/*"] })],
  },
};
```

## `ipFilter` — fail-closed

`deny` wins over `allow`. If the IP can't be read (empty / unparseable), the request is rejected with 403. Reads via `request.detectIp()` which honors `X-Real-IP` and `X-Forwarded-For` (Fastify starts with `trustProxy: true`).

```ts
import { middleware } from "@warlock.js/core";

// Group-wide: pass it through the group's `middleware` array (there is no
// `router.use()` — middleware attaches via group options or route options).
router.group(
  {
    prefix: "/admin",
    middleware: [middleware.ipFilter({ allow: ["10.0.0.0/8", "203.0.113.42"] })],
  },
  () => {
    router.get("/dashboard", dashboardController);
  },
);

// Per-route: pass it in the route's `middleware` array.
router.post("/webhooks/provider", webhookController, {
  middleware: [middleware.ipFilter({ allow: ["198.51.100.0/24"] })],
});
```

IPv4 CIDR matching only — IPv6 patterns are matched as exact strings.

## `cache` — response caching

Cache successful JSON responses by key, serve replays from cache until TTL expiry. Useful for expensive read endpoints (analytics dashboards, expensive aggregations).

```ts
import { middleware } from "@warlock.js/core";

router.get("/analytics/summary", summaryController, {
  middleware: [middleware.cache({ cacheKey: "analytics.summary", ttl: 300 })],
});
```

`cacheKey` can be a string OR a function `(request) => string | Promise<string>` for per-request keys. Excludes failures and omits `["user", "settings"]` from the cached body by default.

## Composed example

Tight cap on logins, concurrency + idempotency on AI calls:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { middleware, router } from "@warlock.js/core";

router.post("/auth/login", loginController, {
  middleware: [
    middleware.rateLimit({ max: 5, duration: 60_000 }),
    middleware.maxBodySize("4kb"),
  ],
});

router.group({ middleware: [authMiddleware("client")] }, () => {
  router.post("/ai/summarize", summarizeController, {
    middleware: [
      middleware.rateLimit({ max: 60, duration: 60 * 60 * 1000 }),
      middleware.concurrencyLimit(5),
      middleware.idempotency({ ttl: 60 * 60 }),
    ],
  });
});
```

## Request ID correlation

Not a middleware — wired into `Request.setRequest()` and `createRequestStore()`. Nothing to register; it runs on every request automatically.

Every request gets a `request.id` (32-char random string by default). The framework:

1. **Inherits** an incoming `X-Request-Id` header if it's well-formed (printable ASCII, ≤128 chars) — so proxies / FE / edge can propagate their own correlation ID end-to-end.
2. **Echoes** `X-Request-Id: <request.id>` on every response — clients can show "request 7a3f… failed" in error toasts; support can grep logs by that single string.
3. **Stamps** `request.id` into every `request.log()` / `response.log()` line — so the per-request correlation is already in your log channel.

Configure via `http.requestId`:

```ts
// src/config/http.ts
import { ulid } from "ulid"; // if you prefer ULID over the default random string

export default {
  requestId: {
    header: "X-Request-Id",   // outbound + inbound header name
    generator: () => ulid(),  // optional override
    enabled: true,            // set false to disable both inherit + echo
  },
};
```

**Request ID is correlation, not idempotency.** A fresh ID is generated on every retry; same key, different ID. For write deduplication on retry, use `middleware.idempotency()`.

## Gotchas

- **Bare factory names are not exported.** Always reach for them via `middleware` (`middleware.rateLimit`, not `rateLimitMiddleware`). The internal `*Middleware`-suffixed names are an in-package code-organization detail.
- **Idempotency must run after auth.** The cache key includes `request.user` for scope-isolation. Putting it before auth silently falls back to IP-scope for every request.
- **In-process counters lose state on restart.** `middleware.rateLimit` and `middleware.concurrencyLimit` use module-scoped `Map`s. A redeploy resets every window/counter. For globally-shared limits, use `@fastify/rate-limit` with a Redis store.
- **Idempotency clients must reuse the key across retries.** If your client generates a new UUID on every attempt, idempotency is a no-op. Generate once at "intent" time.
- **`ipFilter` fail-closed.** Empty / unparseable IP = denied. Internal callers (Unix sockets, local processes) need explicit allowlisting.
- **Maintenance flag is config-driven, restart required.** No runtime hot-flip. Flip via env-var + redeploy.
- **Error messages come from translations.** All status-text messages are `t("http.X")` lookups. The project's `locales.ts` template ships the `http` group. If you fork the template and remove it, errors will fall back to the key name.

## See also

- [`write-middleware/SKILL.md`](../write-middleware/SKILL.md) — author your OWN middleware (custom guards, enrichment).
- [`register-route/SKILL.md`](../register-route/SKILL.md) — where middleware attaches: `router.group` and route-options.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — the response helpers used to short-circuit (`tooManyRequests`, `contentTooLarge`, `serviceUnavailable`, etc.).
- [`@warlock.js/cache/cache-basics/SKILL.md`](../../../cache/skills/cache-basics/SKILL.md) — the cache singleton (`@warlock.js/cache`) that backs `middleware.idempotency` and `middleware.cache`.
