---
name: use-cache-atomic
description: 'Atomic counters via cache.increment(key, by=1, { ttl }?) / cache.decrement(key, by=1) — returns the new number, throws on non-numeric values. Triggers: `cache.increment`, `cache.decrement`, "view counter", "page views", "atomic counter", "decrement stock", "rate-limit counter", "INCRBY"; typical import `import { cache } from "@warlock.js/cache"`. Skip: read-modify-write of objects — the `use-cache-update-merge` topic; named-lock coordination — the `use-cache-lock` topic; competing libs `ioredis` `INCR`, native counters in a `Map`.'
---

# Atomic counters — `cache.increment` / `cache.decrement`

Numeric counters that go up and down without a read-then-write race in your own
code. Both return the **new** value after the operation.

```ts
import { cache } from "@warlock.js/cache";

const views = await cache.increment(`post.${id}.views`); // +1 → 1, 2, 3…
const bulk = await cache.increment(`post.${id}.views`, 10); // +10
const left = await cache.decrement(`stock.${sku}`, 3); // -3
```

- A missing key is treated as `0`, so the first `increment` returns `by` (default `1`).
- `decrement(key, n)` is exactly `increment(key, -n)`.
- The stored value must be numeric — incrementing a string/object throws:
  `Error: Cannot increment non-numeric value for key: <key>`.

## Atomicity is per-driver

`increment`, `decrement`, `pull` and `update` are atomic, but only some drivers are atomic **across servers**:

| Driver                                       | `increment` / `decrement` | `pull`                              | `update` / `merge`                          |
| -------------------------------------------- | ------------------------- | ----------------------------------- | ------------------------------------------- |
| `redis`                                      | cross-server (`INCRBY`)   | cross-server (`GETDEL`)             | cross-server (Lua compare-and-set, retries) |
| `pg`                                         | cross-server (one upsert) | cross-server (`DELETE … RETURNING`) | cross-server (compare-and-set, retries)     |
| `memory` / `memoryExtended` / `lru` / `mock` | one process               | one process                         | one process                                 |
| `file`                                       | one process               | one process                         | not supported (throws)                      |

Use `redis` or `pg` for anything several servers touch (rate limits, login throttles, one-time tokens); memory is per-process. On redis/pg the `update` callback may run more than once under contention: keep it side-effect free.

## TTL is kept

Pass the TTL on **every increment** of an expiring counter:

```ts
await cache.increment("login.failures", 1, { ttl: "1m" });
```

A missing or expired key starts at the amount with that TTL (seconds or duration string); an existing deadline is preserved. An explicit TTL also adds expiry to a live permanent counter, repairing counters left by an earlier seed/increment race. Without `options.ttl`, a fresh key uses the driver's default TTL. Redis applies the count and expiry in one Lua call; Postgres uses one upsert. This closes the race where a separate `set(key, 0, { ttl, onConflict: "create" })` seed expires just before the increment recreates the key. Tagged calls forward the option; namespaces use their default TTL unless overridden per call. Decrements keep existing TTLs too. Use `cache.update` (see the `use-cache-update-merge` topic) for objects.

## Common shapes

```ts
// View counter
await cache.increment(`post.${id}.views`);

// Decrement stock, guard against oversell
const remaining = await cache.decrement(`stock.${sku}`, qty);
if (remaining < 0) {
  await cache.increment(`stock.${sku}`, qty); // roll back
  throw new Error("Out of stock");
}
```

## See also

- The `use-cache-update-merge` topic — atomic read-modify-write for objects, TTL-preserving
- The `use-cache-lock` topic — coordinate multi-step critical sections
- The `pick-cache-driver` topic — when you need cross-node atomicity
