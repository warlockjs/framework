---
title: "Retry"
description: retry(fn, options) from @mongez/reinforcements — attempts, delay, backoff, jitter, maxDelay, shouldRetry, signal. The smallest wrapper that turns a flaky call into a reliable one, with a one-clause rule about what's safe to retry.
sidebar:
  order: 8
  label: "Retry"
---

Networks blip. Databases deadlock. Webhooks return 503 because the receiver's deploying. Most production code has at least one call site where the first attempt fails for reasons that have nothing to do with you, and the second attempt would have worked fine.

`retry()` is the wrapper for that case. It runs your function. If it throws, it waits a beat and tries again — up to an attempt count you pick — and re-throws the last error if every attempt fails.

:::note[Where it lives]
`retry` (and its companion `retryable`) ship from **`@mongez/reinforcements`**, not `@warlock.js/core`. There is no `import { retry } from "@warlock.js/core"` — that older home was removed. `measure()` (for timing) still lives in `@warlock.js/core`.
:::

## The 30-second look

```ts
import { retry } from "@mongez/reinforcements";

const user = await retry(() => fetchUser(id), {
  attempts: 4,
  delay: 200,
});
```

That's four total attempts (the initial call plus three retries), with 200 milliseconds between each. If the fourth attempt also throws, `retry()` re-throws the error. If any attempt succeeds, you get the value.

The signature is:

```ts
retry<T>(fn: () => T | Promise<T>, options?: RetryOptions): Promise<T>
```

`fn` is called fresh each time — closures over the same arguments, no special handling. The result of `fn()` is awaited; the wrapper handles both sync and async returns.

## `RetryOptions`

| Field         | Type                                          | Default      | Notes                                                            |
| ------------- | --------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| `attempts`    | `number`                                      | `3`          | **Total** tries, including the first. `attempts: 3` = 3 calls.   |
| `delay`       | `number` (ms)                                 | `0`          | Base wait between attempts (scaled by `backoff`).               |
| `backoff`     | `"linear" \| "exponential" \| (attempt, baseDelay) => number` | `"linear"` | Delay growth strategy.                            |
| `maxDelay`    | `number` (ms)                                 | —            | Ceiling applied to the computed delay (after backoff, before jitter). |
| `jitter`      | `false \| "full" \| "equal"`                  | `false`      | Randomise each delay to avoid a thundering herd.                |
| `onError`     | `(error, attempt) => void`                    | —            | Observe each failed attempt (logging/metrics). `attempt` is **1-based**. |
| `shouldRetry` | `(error, attempt) => boolean \| Promise<boolean>` | —        | Return `false` to stop immediately and re-throw. `attempt` is **1-based**. |
| `signal`      | `AbortSignal`                                 | —            | Cancel the loop between or during attempts.                     |

A few things worth pulling out:

**`attempts` is the TOTAL, not extra.** This is the single most common off-by-one. `attempts: 1` means "try once, don't retry" — `retry()` becomes a thin pass-through. `attempts: 4` means "try four times total." If your retry budget is "try at most 5 times," set `attempts: 5`.

**`backoff` scales the delay.** `"linear"` (the default) keeps `delay` constant; `"exponential"` doubles it each round (`delay`, `2×delay`, `4×delay`, …). Pass a function for anything bespoke. Cap runaway growth with `maxDelay`, and add `jitter` to spread retries across clients so they don't all re-collide in waves.

**`shouldRetry(error, attempt)` and `onError(error, attempt)`:**

- `attempt` is **1-based** — the first failure passes `attempt: 1`, the second `attempt: 2`, and so on.
- `shouldRetry` returning `false` immediately re-throws the current error (no further attempts, no delay). It can be async.
- `onError` only observes — it can't stop the loop. Use it for logging/metrics; use `shouldRetry` to decide.
- Errors thrown from inside the predicate propagate up. Keep it simple.

## What's safe to retry — the one rule

**Idempotency.** If running `fn()` twice gives the same outcome as running it once, you can retry. If running it twice charges the customer twice, you cannot.

Three buckets in practice:

| Operation                                                | Safe to retry?                            |
| -------------------------------------------------------- | ----------------------------------------- |
| GET / SELECT / cache lookup / read from S3               | Always.                                   |
| PUT with a known ID / Stripe charge with `Idempotency-Key` / DynamoDB conditional write | If the server dedupes — yes.              |
| POST that creates a record / payment without idempotency key / `INSERT` without unique constraint / `mailer.send` without `Message-ID` | **No.** You'll get duplicates.            |

When in doubt, gate retries with `shouldRetry`:

```ts
import { retry } from "@mongez/reinforcements";

await retry(() => stripe.charges.create(payload), {
  attempts: 4,
  delay: 500,
  shouldRetry: (error) =>
    error instanceof NetworkError || error instanceof TimeoutError,
});
```

The principle: "retry transient infrastructure failures, never retry anything that means the request reached the destination." A `NetworkError` means Stripe never saw the request — safe. A 4xx from Stripe means the request landed and they refused it — never retry.

## Common patterns

### Fetch with limited retries

The bread and butter:

```ts
import { retry } from "@mongez/reinforcements";

const data = await retry(
  async () => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  },
  { attempts: 4, delay: 500 },
);
```

Three retries, half a second between each. If the URL is unreachable for two seconds, this still has a fighting chance.

### Exponential backoff with a cap and jitter

For external APIs under load, grow the delay and spread it so retries don't synchronise into waves:

```ts
await retry(() => fetch(url), {
  attempts: 6,
  delay: 100,
  backoff: "exponential", // 100, 200, 400, 800 ms ...
  maxDelay: 2_000,        // never wait more than 2s
  jitter: "full",         // randomise each delay
});
```

### Skip retries on 4xx, retry on 5xx and network errors

A 400 means you sent something bad — retrying won't fix it. A 503 might fix itself.

```ts
class ClientError extends Error {
  public constructor(public status: number) {
    super(`Client error: ${status}`);
  }
}

class ServerError extends Error {
  public constructor(public status: number) {
    super(`Server error: ${status}`);
  }
}

await retry(
  async () => {
    const response = await fetch(url);

    if (response.status >= 400 && response.status < 500) {
      throw new ClientError(response.status);
    }

    if (!response.ok) {
      throw new ServerError(response.status);
    }

    return response.json();
  },
  {
    attempts: 4,
    delay: 500,
    shouldRetry: (error) => error instanceof ServerError,
  },
);
```

`ClientError` bails out immediately. `ServerError` retries. Anything else (a `TypeError` from `fetch` blowing up at the network layer) also retries — the predicate only returns `false` for the one class we want to abort on.

### Cancel a long retry loop

`signal` plumbs an `AbortController` through the loop — a pending delay is raced against the signal so an abort resolves promptly instead of waiting the delay out:

```ts
const controller = new AbortController();

const promise = retry(poll, {
  attempts: 10,
  delay: 1_000,
  signal: controller.signal,
});

controller.abort(); // rejects promptly with the signal's reason
```

### Optimistic-concurrency DB write

If your database driver throws on row-version conflicts, retry is the conflict-resolution strategy:

```ts
import { retry } from "@mongez/reinforcements";

await retry(
  async () => {
    const order = await Order.find(id);

    if (!order) {
      throw new Error("Order not found");
    }

    order.set("total", computeNewTotal(order));

    // throws ConcurrentUpdateError if the row's version changed
    // between the find above and the save below
    await order.save();
  },
  {
    attempts: 6,
    delay: 50,
    shouldRetry: (error) => error instanceof ConcurrentUpdateError,
  },
);
```

Tight loop (50ms), generous budget (6 total attempts). The expected case is "someone else updated the row, re-read the latest version, re-apply your change." If you're still conflicting after six attempts, something is genuinely contended and you should fail loudly.

### Pre-bind options with `retryable`

When the same function is retried from several call sites, `retryable` binds the options once:

```ts
import { retryable } from "@mongez/reinforcements";

const fetchUser = retryable(getUser, { attempts: 4, backoff: "exponential" });

await fetchUser(id);
await fetchUser(otherId); // same retry policy, no re-passing options
```

## Composing with `measure()`

`retry()` and `measure()` (from `@warlock.js/core`) stack naturally. Where you put `measure()` matters:

```ts
import { measure } from "@warlock.js/core";
import { retry } from "@mongez/reinforcements";

// measure() OUTSIDE — total wall-clock time including retries
const result = await measure("publish-event", () =>
  retry(() => bus.publish(event), { attempts: 4, delay: 200 }),
);

console.log(result.latency); // total time, all attempts
```

```ts
// measure() INSIDE — each attempt timed individually
await retry(
  () => measure("publish-event", () => bus.publish(event)),
  { attempts: 4, delay: 200 },
);
```

Heads-up on the second form: `measure()` doesn't throw — it returns a discriminated `BenchmarkResult`. Inside `retry()`, that means the inner `fn()` never throws and `retry()` never sees a failure to retry. If you want each attempt timed *and* the retry loop to fire, re-throw from the error result yourself, or use the outside-form. Default to `measure()` on the outside unless you genuinely need per-attempt timings.

See [Benchmark](./benchmark.md) for the `measure()` surface.

## Use-case integration — the higher-level wrap

Warlock's [`useCase()`](../the-basics/use-cases-deep.md) primitive accepts a `retry` field (the same `RetryOptions`) that wraps the **handler** under the hood:

```ts
import { useCase } from "@warlock.js/core";

export const sendWebhook = useCase<WebhookResult, WebhookInput>({
  name: "send_webhook",
  handler: async (input, context) => {
    return postToWebhook(input.url, input.payload);
  },
  retry: {
    attempts: 4,
    delay: 500,
    backoff: "exponential",
    shouldRetry: (error) => error instanceof NetworkError,
  },
});
```

The difference between this and a raw `retry(...)` inside the handler is **the unit of retry**. Use the use-case option when retrying conceptually means *"re-run the handler"*. Use raw `retry()` inside the handler when only one specific step is flaky and the rest of the pipeline should run once. (Guards, validation, and the `onExecuting` prelude do not re-run on each retry attempt — only the handler does.)

A failed payment provider call is usually the inner-`retry()` case. A flaky third-party webhook is usually the use-case-level case.

## Gotchas

- **`attempts` is the TOTAL count.** `attempts: 3` runs the function 3 times, not 4. Read it as "maximum total tries including the first."
- **`backoff` defaults to `"linear"` (constant delay).** Opt into `"exponential"` explicitly when you want growth, and pair it with `maxDelay` so the wait doesn't balloon.
- **`shouldRetry` / `onError` use a 1-based `attempt`.** The first failure is `attempt: 1`. `onError` only observes; only `shouldRetry` returning `false` stops the loop.
- **Don't retry inside a database transaction.** Most drivers invalidate the transaction the moment a statement fails — every retry attempt fails with "transaction aborted." Retry the whole transaction, not the inner statement.
- **Errors from `shouldRetry` aren't caught.** Throwing inside the predicate propagates up unchanged. Keep it to type checks and `instanceof`, not business logic.
- **Watch for layered retries.** Three retries in a service, calling a function that already has three retries inside it, calling a fetch that retries internally — you've built a 27× explosion on a single bad packet. Pick one layer to own the retry policy; pass through everywhere else.

## Going further

- **`@mongez/reinforcements`** — the home of `retry` / `retryable` (plus `sleep`, `timeout`, and the `pAll` / `pMap` concurrency helpers). See that package's own docs for the full async toolbox.
- [Benchmark](./benchmark.md) — `measure()` for timing retried operations.
- [Use-cases deep dive](../the-basics/use-cases-deep.md) — pipeline-level retries via `useCase({ retry })`.
