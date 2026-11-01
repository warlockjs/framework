---
name: use-cache-extend
description: 'Sliding expiry via cache.extend(key, ttl) — keeps the value and resets expiry to ttl from now (not added to time left); false when the key is missing. Triggers: `cache.extend`, "keep the session alive", "sliding expiration", "touch a cache key". Skip: refresh the value — `cache.set`; slide on every read — `memoryExtended` driver in `pick-cache-driver`.'
---

# `cache.extend(key, ttl)` — sliding expiry

Keeps the cached value and makes it expire `ttl` from now. Resolves to `true` when extended, `false` when the key is missing or already expired (nothing is created).

```ts
const alive = await cache.extend(`session.${id}`, "30m");
```

## Rules

- It RESETS the deadline to `ttl` from the call. It does not add `ttl` to the time left: a 10-minute entry with 4 minutes left, extended by `"10m"`, expires in 10 minutes, not 14. A shorter `ttl` shortens the entry.
- `ttl` takes the same forms as `set`: seconds or a duration string. `0` or `Infinity` removes the expiry. Negative, `NaN` or an unparseable string throws `CacheConfigurationError`.
- Works on `cache`, `cache.namespace(...)` (key is prefixed) and `cache.tags(...)` (tags untouched).
- Redis uses one atomic `PEXPIRE`; `pg` one `UPDATE`; memory drivers update in place; `file` and custom `BaseCacheDriver` subclasses read and rewrite the value. `null` always returns `false`.

Docs: `/v/latest/cache/extend/`.
