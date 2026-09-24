---
title: "Running on multiple servers"
description: What changes when you run more than one Warlock server — shared cache, rate limits, socket adapter, scheduler onOneServer, S3/R2 storage, and the production warnings that point at each.
sidebar:
  order: 12
  label: "Multiple servers"
---

By default Warlock keeps state in the process: memory cache, local disk, in-process socket rooms, in-process counters. That is right for one server. With two or more, each piece needs a shared backend. In production Warlock warns once at boot for the ones it can detect.

| Concern | Single-server default | Multi-server setup | Silence the warning |
| --- | --- | --- | --- |
| Cache, repository cache, locks | Memory driver | `redis` or `pg` cache driver — see [Cache](./cache.md) | `cache.silenceSingleServerWarning` |
| Files | Local disk | S3 or R2 — see [Storage](./storage.md) and [Upload to S3](../recipes/upload-to-s3.md) | `storage.silenceSingleServerWarning` |
| Global rate limit | In-process | `http.rateLimit.redis` | n/a |
| Sockets | In-process rooms | `socket.adapter` + sticky sessions | `socket.silenceSingleServerWarning` |
| Scheduled jobs | Runs on every server | `onOneServer` — see [Overlap prevention](../../scheduler/guides/overlap-prevention/) | n/a |
| Idempotency keys | Cache-backed | Shared cache (above) | n/a |

## Rate limiting

`http.rateLimit` passes [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) options through:

```ts
import Redis from "ioredis";

export default {
  rateLimit: {
    max: 100,
    duration: 60_000,
    redis: new Redis(process.env.REDIS_URL),
  },
};
```

`enabled: false` turns the global limiter off. The per-route `middleware.rateLimit()` stays in-process, so its counters are per server.

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
