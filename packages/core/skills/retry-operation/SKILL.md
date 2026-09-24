---
name: retry-operation
description: 'Wrap a flaky operation with `retry(fn, options)` — now provided by `@mongez/reinforcements` (not `@warlock.js/core`). `attempts` total tries, `delay` + `backoff` (linear/exponential/fn), `maxDelay`, `jitter`, `shouldRetry` to bail on permanent errors, `signal` to cancel, plus `retryable()` to pre-bind options. Triggers: `retry`, `retryable`, `RetryOptions`, `attempts`, `backoff`, `jitter`, `maxDelay`, `shouldRetry`, `signal`; "retry a flaky API call", "handle transient errors", "exponential backoff with jitter", "wrap an external request"; typical import `import { retry } from "@mongez/reinforcements"`. Skip: timing the retried op — `@warlock.js/core/benchmark-code/SKILL.md`; use-case-level `retry` option — `@warlock.js/core/write-use-case/SKILL.md`; competing libs `p-retry`, `async-retry`, `cockatiel`.'
---

# Warlock — retry an operation

> **Moved.** The retry primitive now lives in **`@mongez/reinforcements`**, not
> `@warlock.js/core`. The old `import { retry } from "@warlock.js/core"` no longer
> exists. Full reference: [`mongez-reinforcements-async`](mongez-reinforcements-async).

```ts
import { retry } from "@mongez/reinforcements";

const user = await retry(() => fetchUser(id), {
  attempts: 4,            // TOTAL tries (initial + retries) — default 3
  delay: 200,             // base ms between attempts
  backoff: "exponential", // 200, 400, 800 ms
});
```

## What changed from the old core `retry`

| Old (`@warlock.js/core`)       | New (`@mongez/reinforcements`)                            |
| ------------------------------ | -------------------------------------------------------- |
| `count` = **extra** attempts   | `attempts` = **total** attempts (`count + 1`)            |
| fixed `delay` only             | `delay` + `backoff` (`"linear" \| "exponential" \| fn`)  |
| —                              | `maxDelay`, `jitter` (`"full" \| "equal"`), `signal`     |
| `shouldRetry(error, attempt)`  | `shouldRetry(error, attempt)` (kept) + `onError` observe |
| —                              | `retryable(fn, options)` to pre-bind a reusable wrapper  |

Migration: `count: 3` → `attempts: 4`.

## Bail out on permanent errors

Observe with `onError`, decide with `shouldRetry` (called in that order). Return `false` to stop immediately and re-throw:

```ts
await retry(() => stripe.charges.create(payload), {
  attempts: 4,
  delay: 500,
  shouldRetry: (error) => error instanceof NetworkError || error instanceof TimeoutError,
});
```

## What's safe to retry

- **Idempotent reads** (GET, SELECT, cache lookups) — always safe.
- **Idempotent writes** with server-side dedup (Stripe `Idempotency-Key`, conditional writes, PUT to a known id) — safe.
- **Non-idempotent writes** (a POST that charges a card, sends an email) — dangerous. Gate with `shouldRetry` so only transient infra errors retry.

## Backoff + jitter + cap

```ts
await retry(() => fetch(url), {
  attempts: 6,
  delay: 100,
  backoff: "exponential",
  maxDelay: 2_000,   // never wait more than 2s as backoff grows
  jitter: "full",    // randomise each delay to avoid thundering herd
});
```

## Cancel a long loop

```ts
const controller = new AbortController();
const promise = retry(poll, { attempts: 10, delay: 1_000, signal: controller.signal });
controller.abort(); // rejects promptly with signal.reason
```

## Pre-bind with `retryable`

```ts
import { retryable } from "@mongez/reinforcements";

const fetchUser = retryable(getUser, { attempts: 4, backoff: "exponential" });
await fetchUser(id);
```

## Composing with `measure()`

`measure()` (from `@warlock.js/core`) returns a result object and doesn't throw on `fn` failure — so put `measure` **inside** `retry` (per-attempt timing) and re-throw, or **outside** for total wall-clock:

```ts
import { measure } from "@warlock.js/core";
import { retry } from "@mongez/reinforcements";

const result = await measure("publish-event", () =>
  retry(() => bus.publish(event), { attempts: 4, delay: 200 }),
); // result.latency includes all retries
```

## Use-case integration

`useCase()` accepts a `retry` option (the same `RetryOptions`) that wraps the **handler** — see [`@warlock.js/core/write-use-case/SKILL.md`](@warlock.js/core/write-use-case/SKILL.md). Reach for that when "retry" means "re-run the handler"; reach for raw `retry()` when only one step inside is flaky.

## Gotchas

- **`attempts` is the TOTAL, not extra.** `attempts: 3` = 3 calls. (The old core `count: 3` meant 4 calls.)
- **`shouldRetry` decides, `onError` observes.** `onError` can't stop the loop; only `shouldRetry` returning `false` does.
- **Don't retry inside a DB transaction.** Most drivers invalidate the transaction on error — retry the whole transaction, not the inner statement.
- **`exponential` + many `attempts` without `maxDelay`** can produce very long waits. Set `maxDelay`.

## See also

- [`mongez-reinforcements-async`](mongez-reinforcements-async) — full `retry` / `retryable` reference.
- [`@warlock.js/core/benchmark-code/SKILL.md`](@warlock.js/core/benchmark-code/SKILL.md) — timing retried operations.
- [`@warlock.js/core/write-use-case/SKILL.md`](@warlock.js/core/write-use-case/SKILL.md) — the use-case `retry` option.
