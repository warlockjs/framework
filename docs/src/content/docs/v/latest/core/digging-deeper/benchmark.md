---
title: "Benchmark"
description: measure(name, fn, options?) — wrap any call to time it, classify it against excellent/poor thresholds, fire hooks, and route stats to a profiler. Use-cases benchmark by default.
sidebar:
  order: 9
  label: "Benchmark"
---

Performance problems hide in the operations you're not looking at. The endpoint that's *usually* fast but spikes to a second twice a day. The cache lookup that's instant in dev but takes 300ms when the cache is cold. The third-party API that started getting slower last week and nobody noticed.

`measure()` is the wrapper that surfaces all of it. Time any function, classify the result against latency thresholds you pick, fire hooks for downstream observability, and optionally accumulate percentile stats over time. Around the same primitive, two optional helpers — `BenchmarkProfiler` for p50/p95/p99, `BenchmarkSnapshots` for raw error captures.

## The mental model

```
   measure(name, fn, options)
              │
              │ runs fn(), times it
              ▼
   ┌──────────────────────┐
   │ BenchmarkResult      │ ← discriminated by `success`
   │  - success: true     │
   │  - value: T          │
   │  - latency: 247      │
   │  - state: "good"     │
   │  - tags: { … }       │
   └──────┬───────────────┘
          │
          ├─ profiler.record(result)?      → adds latency to rolling p50/p95/p99 buckets
          ├─ snapshotContainer.record(…)?  → stores the full result for post-mortem
          ├─ onComplete(result)?           → success-only hook
          ├─ onError(result)?              → error-only hook
          └─ onFinish(result)              → always fires last
```

Three things to internalize before we go further:

1. **`measure()` never throws.** It always returns. If `fn()` throws, you get a `BenchmarkErrorResult` — `result.success === false`, `result.error` holds the thrown value. The one exception is `shouldBenchmarkError: false`, which re-throws (covered below).
2. **The return type is discriminated.** `result.success` narrows the type — `result.value` only exists on success, `result.error` only on failure. TypeScript will refuse to let you access the wrong one.
3. **Hooks are fire-and-forget.** `onComplete`/`onError` run, then `onFinish` runs, then the result is returned. Throwing inside a hook crashes the call — keep them side-effect-only.

## The 30-second look

```ts
import { measure } from "@warlock.js/core";

const result = await measure("db.findUser", () => db.users.findOne({ id }));

if (result.success) {
  console.log(result.value);    // the user object
  console.log(result.latency);  // 42
  console.log(result.state);    // "good"
} else {
  console.error(result.error);  // the thrown error
}
```

That's the entire happy path. Wrap a function, get a typed result, branch on `success`.

## `BenchmarkResult` — what you get back

Both success and error share these fields:

```ts
{
  name: string;                              // your measurement name
  latency: number;                           // ms (rounded)
  state: "excellent" | "good" | "poor";      // see latencyRange
  tags?: Record<string, string>;             // whatever you passed in options.tags
  startedAt: Date;
  endedAt: Date;
}
```

Plus, discriminated by `success`:

```ts
// success
{ success: true,  value: T }

// error
{ success: false, error: unknown }
```

That's the lot. `value` only on success, `error` only on failure — the discriminant on `success` narrows the type for you.

## `latencyRange` — classifying speed

Without thresholds, every successful result is `"good"` and every failure is `"poor"`. Set `latencyRange` and you get a meaningful `state`:

```ts
await measure("db.findUser", () => db.users.findOne({ id }), {
  latencyRange: { excellent: 100, poor: 500 },
});

// latency <= 100ms       → state: "excellent"
// 100ms < latency < 500  → state: "good"
// latency >= 500ms       → state: "poor"
```

The two boundary fields are exactly `excellent` (the upper bound for "excellent") and `poor` (the lower bound for "poor"). Anything between is `"good"`.

Most apps set this globally rather than per-call. Drop it in `src/config/benchmark.ts` and `measure()` reads it as the fallback — only override per-call when one operation has wildly different expectations.

```ts title="src/config/benchmark.ts"
import {
  BenchmarkProfiler,
  ConsoleChannel,
  type BenchmarkConfigurations,
} from "@warlock.js/core";

const benchmarkConfig: BenchmarkConfigurations = {
  enabled: true,
  latencyRange: { excellent: 100, poor: 500 },
  profiler: new BenchmarkProfiler({
    maxSamples: 1000,
    channels: [new ConsoleChannel()],
    flushEvery: 60_000,
  }),
};

export default benchmarkConfig;
```

Every `measure()` call now defaults to those thresholds and records into that profiler. Per-call options always win — override `latencyRange` on a specific measurement and the global is ignored for that call.

## Hooks

Three optional callbacks. `onComplete` *or* `onError` fires (never both), then `onFinish` always fires:

```ts
await measure("send-email", () => mailer.send(payload), {
  latencyRange: { excellent: 200, poor: 2000 },
  onComplete: (result) => metrics.record(result.latency),
  onError: (result) => logger.error("email failed", result.error),
  onFinish: (result) => logger.info(`${result.name} → ${result.state}`),
});
```

`onFinish` is the most useful default — it sees both branches and runs unconditionally. Reach for `onComplete`/`onError` when the success and failure paths need different observability (e.g., bump a different metric).

## Tags — metadata you'll thank yourself for

Tags ride along on the result and on every profiler/snapshot record. They don't change behavior; they're metadata you grep on later:

```ts
await measure("http.outbound", () => fetch(url), {
  tags: { service: "stripe", endpoint: "/charges" },
});
```

When you're staring at three operations with the same name across five services, tags are what tell you which one is which. Use them.

## Selective error capture — `shouldBenchmarkError`

Business errors (400 Bad Request, ValidationError) are not infrastructure problems. They're not slow because the database is hot — they're "fast" because the validator rejected the input in two milliseconds. Including them in latency stats poisons the percentiles.

Return `false` to **re-throw** the error without producing a benchmark result:

```ts
import { ValidationError } from "@warlock.js/seal";

await measure("create-user", () => createUser(input), {
  shouldBenchmarkError: (error) => !(error instanceof ValidationError),
});
```

The default is `true` — every thrown error becomes a `BenchmarkErrorResult`. Override only when you have a specific class of errors that should bypass benchmarking entirely.

This is the one case where `measure()` does throw. If `shouldBenchmarkError` returns `false`, the error propagates up to the caller — the wrapper is no longer in the picture.

## `enabled: false` — pass-through mode

Wrapping costs almost nothing — one `performance.now()` and a closure — but if you want a literal no-op for a hot path:

```ts
const result = await measure("hot-path", () => work(), { enabled: false });
// result.latency === 0
// result.state   === "excellent"
// no hooks fire
// no profiler record, no snapshot
```

`fn()` still runs and its return value still lands in `result.value`. The wrapper just skips timing, hooks, and recording. Useful for keeping uniform call sites — the same code reads cleaner whether timing is on or off.

You can flip the global `enabled` field in `src/config/benchmark.ts` to turn timing off framework-wide; per-call `enabled: false` overrides for one site.

## `BenchmarkProfiler` — rolling percentiles

For high-volume operations where per-call hooks are too noisy, you want p50/p95/p99 across a window:

```ts
import { BenchmarkProfiler, ConsoleChannel, measure } from "@warlock.js/core";

const profiler = new BenchmarkProfiler({
  maxSamples: 1000,                  // ring buffer per operation name
  channels: [new ConsoleChannel()],  // where stats go on flush()
  flushEvery: 60_000,                // auto-flush every minute
});

for (let i = 0; i < 100; i++) {
  await measure(
    "db.findUser",
    () => db.users.findOne({ id: i }),
    { profiler, latencyRange: { excellent: 50, poor: 300 } },
  );
}

const stats = profiler.stats("db.findUser");
// { p50, p90, p95, p99, avg, min, max, count, errors, errorRate, firstSeenAt, lastSeenAt }
```

`profiler.stats(name)` returns the snapshot synchronously — useful for ad-hoc inspection. `profiler.flush()` hands `allStats()` to every registered channel, then continues accumulating into the same ring buffer.

Wire it in `src/config/benchmark.ts` and every `measure()` call records by default — no per-call wiring needed.

### Lifecycle — `reset()` and `dispose()`

The profiler keeps two pieces of state you may need to manage explicitly:

- **`profiler.reset(name?)`** — clears the rolling latency ring buffer for one operation (or all of them when `name` is omitted). It does **not** reset the unbounded `count`/`errors` counters, so `errorRate` keeps its historical denominator. Reach for it when you want fresh percentiles after a deploy without losing lifetime totals.
- **`profiler.dispose()`** — stops the auto-flush `setInterval` started by `flushEvery`. This is a real leak footgun: a profiler constructed with `flushEvery` holds a live timer, and if you build profilers per-request or per-test instead of once at config time, every one of them keeps the process (or the Vitest worker) alive until you call `dispose()`. The single config-time profiler doesn't need it; throwaway profilers do.

```ts
const profiler = new BenchmarkProfiler({ flushEvery: 60_000 });
// ... use it ...
profiler.reset();    // wipe ring buffers, keep lifetime counters
profiler.dispose();  // clear the flush interval so the process can exit
```

### `BenchmarkChannel` — where stats go

A channel is anything that implements `onFlush(stats)`:

```ts
interface BenchmarkChannel {
  onFlush(stats: Record<string, BenchmarkStats>): void | Promise<void>;
}
```

Two are built in:

- **`ConsoleChannel`** — pretty-prints a `console.table` per operation. Useful in dev.
- **`NoopChannel`** — the default. Drops the call. Use when you want stats accessible via `profiler.stats(name)` without any external emission.

Custom channels are a one-class job:

```ts
import type { BenchmarkChannel, BenchmarkStats } from "@warlock.js/core";

export class DatadogChannel implements BenchmarkChannel {
  public async onFlush(stats: Record<string, BenchmarkStats>): Promise<void> {
    for (const [name, operationStats] of Object.entries(stats)) {
      await datadog.gauge(`latency.${name}.p95`, operationStats.p95);
      await datadog.gauge(`latency.${name}.p99`, operationStats.p99);
      await datadog.gauge(`latency.${name}.error_rate`, operationStats.errorRate);
    }
  }
}
```

Pass it via `channels: [new DatadogChannel()]` and every `flush()` (manual or auto) pushes percentiles to Datadog.

## `BenchmarkSnapshots` — raw captures

Percentiles tell you "we got slow." Snapshots tell you "*here are the exact requests* that got slow." For post-mortem work:

```ts
import { BenchmarkSnapshots, measure } from "@warlock.js/core";

const snapshots = new BenchmarkSnapshots({
  maxSnapshots: 100,
  capture: "error",   // "error" (default, safe) | "value" | "all"
});

await measure("payment.charge", () => stripe.charge(payload), {
  snapshotContainer: snapshots,
});

const failed = snapshots.getSnapshots("payment.charge");
// array of full BenchmarkErrorResult — error, latency, startedAt, tags
```

The `capture` setting matters:

| `capture` | What's stored                                                                  | Memory profile          |
| --------- | ------------------------------------------------------------------------------ | ----------------------- |
| `"error"` | Only `BenchmarkErrorResult`. The default.                                      | Bounded by failure rate. Safe in production. |
| `"value"` | Only `BenchmarkSuccessResult<T>` with the full return value.                   | Stores T in memory.     |
| `"all"`   | Both.                                                                          | Stores T in memory.     |

`"value"` and `"all"` keep references to whatever `fn()` returned. If that's a database row, that's fine. If it's a streamed response or a large buffer, you've now kept it in memory until the ring buffer evicts it. Default to `"error"` unless you have a specific reason.

Wire snapshots globally in `src/config/benchmark.ts` the same way as the profiler.

## Auto-integration with use-cases

Every [`useCase()`](../the-basics/use-cases-deep.md) wraps its **handler** in `measure()` by default — `benchmark` defaults to `true`. You get a per-use-case latency and a `benchmarkResult` field (`{ latency, state }`) on every execution snapshot without writing any timing code.

The use-case layer adds **no thresholds of its own**. When `benchmark: true`, it calls `measure()` with no per-call options, so the `state` falls back to whatever `latencyRange` you set in `src/config/benchmark.ts` — and without that config the state is just `"good"`/`"poor"`. There is no built-in `{ excellent: 100, poor: 200 }` default; set one globally if you want meaningful classification.

Override per use-case by passing a `BenchmarkOptions` object to the `benchmark` field (the field is `benchmark`, not `benchmarkOptions`):

```ts
import { useCase } from "@warlock.js/core";

export const placeOrder = useCase<Order, PlaceOrderInput>({
  name: "place_order",
  handler: async (input) => placeOrderService(input),
  benchmark: {
    latencyRange: { excellent: 200, poor: 1000 },
    tags: { domain: "orders" },
    onComplete: (result) => metrics.histogram("place_order.latency", result.latency),
  },
});
```

Set `benchmark: false` to disable benchmarking for one use-case — useful for use-cases that wrap genuinely long-running work where latency stats don't carry meaning.

The handler benchmark wraps **only the handler, per retry attempt** — not the guard/validation prelude and not the retry backoff delays. So when a use-case sets both `retry` and `benchmark`, the `benchmarkResult.latency` reflects the latest attempt's handler time, not the total wall-clock across retries. (If you want total-including-retries latency, wrap the whole call in your own `measure()` as shown below.)

## Common patterns

### Time a service call

```ts
const result = await measure("create-order", () => createOrderService(input));

if (!result.success) {
  return response.badRequest({ error: t("order.failed") });
}

return response.successCreate({ order: result.value });
```

The result is your error-handling fork *and* your latency tracker. Less ceremony than a try/catch.

### Time an external HTTP call

```ts
const result = await measure(
  "stripe.charge",
  () => stripe.charges.create({ amount, currency, source }),
  {
    latencyRange: { excellent: 200, poor: 3000 },
    tags: { gateway: "stripe", currency },
    shouldBenchmarkError: (error) => error instanceof NetworkError,
  },
);
```

Higher thresholds (Stripe round-trips are slow), tagged for slicing, validation errors skipped.

### Compose with `retry()`

`retry` lives in `@mongez/reinforcements`, not in `@warlock.js/core` — import it from there. Its retry-count option is `attempts` (default `3`), not `count`:

```ts
import { measure } from "@warlock.js/core";
import { retry } from "@mongez/reinforcements";

const result = await measure("publish-event", () =>
  retry(() => bus.publish(event), { attempts: 3, delay: 200 }),
);

console.log(result.latency); // total wall-clock, including all retry attempts
```

`measure()` on the outside captures the SLO you actually care about. See [Retry](./retry.md) for the composition story in full.

### Inspect what's slow, ad-hoc

```ts
import { config, BenchmarkProfiler } from "@warlock.js/core";

const profiler = config.get("benchmark").profiler as BenchmarkProfiler;

console.table(profiler.allStats());
```

If you've wired a profiler in `src/config/benchmark.ts`, you can drop into a debug endpoint and dump the current percentiles at any time. No flush needed — `allStats()` reads the live ring buffers.

## Gotchas

- **Name collisions aggregate.** Two calls to `measure("foo", …)` from different code paths share one profiler bucket. Make `name` specific — `"db.findUser"`, not `"db.query"` — so percentiles actually mean something.
- **`measure()` doesn't propagate AbortSignal.** If `fn` is cancellable, plumb the signal through yourself. The wrapper only times.
- **Don't `measure()` synchronous trivia.** A `Math.round` call isn't worth the microsecond of overhead and the noise in your stats. Reserve `measure()` for things that *can* be slow — I/O, computation that scales with input size, anything crossing a network or disk.
- **Snapshots with `"value"` retain references.** If `value` holds a streamed body or a large buffer, you've kept it in memory until eviction. Default `capture: "error"` keeps you safe.
- **`shouldBenchmarkError` re-throws.** Make sure the caller is ready for an unwrapped throw on that error class. The discriminated-result contract holds for every other path; this one carves out an exception.
- **Hook errors crash the call.** Throwing inside `onComplete`/`onError`/`onFinish` propagates up and discards the measurement. Keep hooks side-effect-only; wrap risky work in their own try/catch.
- **A profiler with `flushEvery` holds a live timer.** The auto-flush `setInterval` keeps the process (and Vitest workers) alive. Construct profilers once at config time. If you ever build a throwaway profiler with `flushEvery`, call `profiler.dispose()` when you're done or it leaks the interval.

## Going further

- [`guides/retry.md`](./retry.md) — composes inside `measure()`. The latency story for retried operations.
- [`guides/use-cases-deep.md`](../the-basics/use-cases-deep.md) — the `benchmark` field on `useCase()` and how the handler-level wrap stacks.
- [`guides/configuration-deep.md`](../architecture-concepts/configuration-deep.md) — `src/config/benchmark.ts` and the global config surface.
