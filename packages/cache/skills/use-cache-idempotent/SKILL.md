---
name: use-cache-idempotent
description: 'Run-once-per-key via idempotent(key, fn, {ttl}) or cache.idempotent — concurrent calls share one run, repeats within ttl replay the stored result, ttl 0 is in-flight dedupe only, failures are never stored. Triggers: `idempotent`, "Idempotency-Key", "dedupe payment", "webhook delivered twice", "retried job". Skip: skip-if-busy lock — `use-cache-lock`; HTTP header middleware — core `idempotency` middleware.'
---

# `idempotent(key, fn, { ttl })`

```ts
import { idempotent } from "@warlock.js/cache";

const charge = await idempotent(`charge.${order.id}`, () => gateway.charge(order), { ttl: "24h" });
```

`cache.idempotent(...)` is the same call on the manager.

## Behaviour

- Concurrent calls with one key share a single run (per process).
- Repeat calls within `ttl` return the stored result without calling `fn`. Falsy, `null` and `undefined` results are stored too.
- `ttl: 0` is pure in-flight dedupe: nothing is read from or written to the cache.
- A run that throws stores nothing; all callers sharing it get the error; the next call runs `fn` again.
- Results live in the cache store under `idempotent.<key>`, so with Redis or Postgres a result is shared across servers.
- Two servers at the same instant each run `fn` unless `distributed: true`, which takes the cache lock (`lockTtl`, default `"30s"`, must exceed `fn`'s duration); waiters read the stored result, take over if the holder fails, and throw `CacheConcurrencyError` after `lockTtl`.
- If storing the result fails, the result is still returned and the failure is logged.
- Options: `ttl` (required), `distributed`, `lockTtl`, `driver`.

Docs: `/v/latest/cache/idempotent/`.
