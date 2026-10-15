---
title: "Known Limitations"
description: An honest, consolidated list of the caveats scattered across the security, deployment, and error-handling guides — single-instance state, the permissive CORS default, proxy/XFF trust, the missing OpenAPI generator, and repository nuances — with pointers to the page that explains each.
sidebar:
  order: 14
  label: "Known Limitations"
---

Every framework has edges. This page collects the ones worth knowing **before** you ship, in one place, so you don't discover them in production. Each item links to the page that covers it in depth — nothing here is new behavior, it's the honest fine print pulled together.

The theme is the same across most of them: **several built-in protections keep their state in the process, not in a shared store.** That's fast and zero-config for a single instance, and exactly what you want in development. It stops being a single source of truth the moment you run more than one replica.

## Single-instance state

These features are correct on one node and degrade silently when you scale horizontally. None of them error — they just enforce a weaker guarantee than you might assume.

- **Per-route rate limiting (`middleware.rateLimit`) is process-local.** Each replica counts independently, so with `N` replicas the effective cap is `N × max`. For a genuinely shared limit, configure `@fastify/rate-limit`'s Redis store through `http.rateLimit`. See [Security → the protective middleware](./security.md).
- **Concurrency limiting (`middleware.concurrencyLimit`) is process-local too.** The in-flight cap is per-process. For a cluster-wide ceiling, reach for a distributed lock via `@warlock.js/cache`. See [Security](./security.md).
- **Idempotency (`middleware.idempotency`) dedupes against the configured cache.** If that cache is the in-memory driver, a retry that lands on a *different* replica won't see the first request's key and will execute twice. Point idempotency at a shared cache (Redis) in production. See [Security](./security.md) and the `EC100` / `EC101` codes in [Error handling](./error-handling.md).
- **The global rate limit (`http.rateLimit`) is a separate, coarser backstop** from the per-route middleware — and it has the same single-instance store caveat unless you wire a shared store. See [Security → the global rate limit is separate](./security.md).

> **Rule of thumb:** if a protection counts requests or remembers keys, and you run more than one instance, give it a shared store (Redis) or treat its guarantee as best-effort.

## Transport & proxy trust

- **Fixed in 4.13.0 — `http.cors` now applies.** Up to and including 4.12.0 the framework's defaults (`{ origin: "*", methods: "*" }`) were spread **after** your configuration, so `http.cors` **could not tighten `origin` / `methods` at all** — an app that configured an allow-list still answered every origin. Your configuration now wins. **If you are upgrading and were unknowingly running open CORS, this will start rejecting origins.** See [Security → CORS](./security.md).
- **Fixed in 4.13.0 — `X-Forwarded-For` / `X-Real-IP` are no longer trusted by default.** `http.trustProxy` now defaults to **`false`**, so `request.detectIp()`, `middleware.ipFilter()` and IP-scoped rate limiting read the socket address. Previously the default was `true`, which meant **a client could send its own forwarding header and be believed** — and because `@fastify/rate-limit` keys its buckets on `request.ip`, a different header per request produced a fresh bucket each time. **Set `http.trustProxy: true` only when you are genuinely behind a proxy that overwrites those headers.** See [Security](./security.md).
- **Since 4.15.0 — bare `true` is rarely the right shape.** An edge that *appends* to `X-Forwarded-For` (nginx, an ALB, most CDNs) leaves whatever the client prepended as the leftmost entry, so `trustProxy: true` ("trust the leftmost hop") can hand the client its own chosen IP straight back. `http.trustProxy` also accepts a trusted-proxy CIDR/IP list (string, comma-separated string, or array) and an `(address, hop) => boolean` predicate, both delegated to Fastify and honoured by `detectIp()`. `X-Real-IP` is only honoured under `trustProxy: true` — it carries no chain to check a list against. See [Security → `trustProxy` shapes](./security.md#trustproxy-shapes).
- **Since 5.2 — `http.trustProxy` is validated at boot, and a number is refused.** The hop-count shape 4.15.0 recommended (`trustProxy: 2`) is no longer accepted: the Fastify version Warlock builds against evaluates a number as always-false, so a hop count silently meant "trust nothing" while reading like a configured proxy chain. A number — along with `""`, `[]`, a mixed array, or an object — now throws a `TypeError` during HTTP server construction rather than being coerced. **If you set a hop count, migrate it to a proxy list or a predicate before upgrading; the app will not boot otherwise.** See [Security → the value is validated at boot](./security.md#the-value-is-validated-at-boot-52).

## API surface

- **There is no OpenAPI / Swagger generator yet.** seal schemas carry `.describe(...)` metadata and JSON-schema output, and validation is declarative, but the framework does not emit an OpenAPI document from your routes today. If you need a spec, generate it from your schemas yourself. See [Validation](../the-basics/validation.md).

## Repository nuances

- **`listCached` / `getCached` cache against the configured cache driver.** On the in-memory driver the cache is per-process, so two replicas can serve different cached snapshots until each expires. Use a shared cache driver if read-after-write consistency across instances matters. See [Repositories](../the-basics/05-repositories.md) and [Cache](./cache.md).
- **`request.all()` feeds the repository's `filterBy` directly.** Only the keys you declare in `filterBy` become query filters — undeclared inputs are ignored, which is the intended safety boundary, but it also means a typo'd filter key silently does nothing rather than erroring. See [Repositories](../the-basics/05-repositories.md).

## Shutdown

- **`SIGKILL` skips graceful shutdown entirely.** Reverse-order connector teardown only runs for `SIGINT` / `SIGTERM` (and `SIGHUP` on Windows). A hard kill gives connectors no chance to close — configure your supervisor to send a terminable signal with a short grace period. See [Deployment](./deployment.md) and [Health checks](./health-checks.md).

## See also

- **[Security](./security.md)** — the protective middleware, the CORS default, proxy trust, and the full hardening checklist.
- **[Production Hardening Checklist](./production-hardening-checklist.md)** — the actionable counterpart to this page: what to set before you ship.
- **[Deployment & production](./deployment.md)** — build/start, environment selection, graceful shutdown.
- **[Error handling](./error-handling.md)** — the `HttpErrorCodes` catalog, including the idempotency codes.
- **[Health checks](./health-checks.md)** — `/health`, `/ready`, and request draining on shutdown.
