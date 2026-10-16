---
title: "Running on multiple servers"
description: What changes when you run more than one Warlock server — shared cache, rate limits, socket adapter, scheduler onOneServer, S3/R2 storage, and the production warnings that point at each.
sidebar:
  order: 12
  label: "Multiple servers"
---

By default Warlock keeps state in the process: memory cache, local disk, in-process socket rooms, in-process counters. That is right for one server. With two or more, each piece needs a shared backend. In production Warlock warns once at boot for the ones it can detect.

| Concern                                         | Single-server default | Multi-server setup                                                                    | Silence the warning                  |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| Cache, repository cache, locks                  | Memory driver         | `redis` or `pg` cache driver — see [Cache](./cache.md)                                | `cache.silenceSingleServerWarning`   |
| Files                                           | Local disk            | S3 or R2 — see [Storage](./storage.md) and [Upload to S3](../recipes/upload-to-s3.md) | `storage.silenceSingleServerWarning` |
| Rate limits (global and `middleware.rateLimit`) | In-process            | `http.rateLimit.store: "cache"` over a shared cache driver                            | n/a                                  |
| Sockets                                         | In-process rooms      | `socket.adapter` + sticky sessions                                                    | `socket.silenceSingleServerWarning`  |
| Scheduled jobs                                  | Runs on every server  | `onOneServer` — see [Overlap prevention](../../scheduler/guides/overlap-prevention/)  | n/a                                  |
| Idempotency keys                                | Cache-backed          | Shared cache (above)                                                                  | n/a                                  |

## Rate limiting

Counts live in the process by default, so with `N` servers every client gets `N × max`. Set `store: "cache"` to count in `@warlock.js/cache` instead: every server using the same shared cache driver (`redis`, `pg`) counts together, and the per-route `middleware.rateLimit()` follows the same setting.

```ts
export default {
  rateLimit: {
    max: 100,
    duration: 60_000,
    store: "cache",
  },
};
```

Shared windows are fixed and aligned to the clock (a 60-second window resets on the minute). Each route with its own `rateLimit` counts separately. A per-route limiter can choose for itself with `middleware.rateLimit({ ..., store: "cache" | "memory" })`; give it a `name` when limiters are created conditionally, so every server keys it the same way.

When the cache is down, both limiters fail open: the request goes through, and the error is logged at most once a minute. For the global limiter that means `skipOnError` defaults to `true` with this store; set `skipOnError: false` to reject requests instead (they get a 500 while the cache is down).

Two cache drivers are refused for `store: "cache"`, with `UnsupportedRateLimitDriverError` (requests then pass, and the refusal is logged the same way):

- `null` stores nothing, so the limit would never trip.
- `file` never removes expired windows, so every past window would stay on disk, and its increment is only serialized within one process, so workers sharing the directory would lose counts.

Use `redis` (any version from 6) or `pg` across servers, or a memory driver for a single process.

`http.rateLimit` also passes [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) options through. Its own `redis` option still works but needs an **ioredis** client; the `redis` driver of `@warlock.js/cache` uses node-redis, so share that connection through `store: "cache"`. A `@fastify/rate-limit` store class can be passed as `store` too. `enabled: false` turns the global limiter off.

## Sockets

```ts
import { createAdapter } from "@socket.io/redis-adapter";

export default {
  adapter: () => createAdapter(pubClient, subClient),
};
```

Enable sticky sessions on the load balancer so long-polling requests from one client reach the same server.

## Idempotency

`middleware.idempotency()` reserves the key before the handler runs; a concurrent duplicate gets 409 + `Retry-After`. That only holds across servers when the cache is shared.

## Repository cache

The repository cache is cleared after the model event and again after the transaction commits. With a memory cache, other servers keep their own copies — use redis or pg.

Cache-backed rate limiting passes its window TTL on every atomic increment. A key recreated after the create-only seed expires still gets an expiry, without extending an existing window. Configure a shared Redis or Postgres driver; no driver default TTL is required for these counters.
