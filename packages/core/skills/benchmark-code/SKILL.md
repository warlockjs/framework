---
name: benchmark-code
description: 'Wrap a function with `measure(name, fn, options?)` to time it and classify the latency — onComplete/onError/onFinish hooks, `latencyRange` thresholds, `BenchmarkProfiler` for percentiles, `BenchmarkSnapshots` for raw captures. Triggers: `measure`, `BenchmarkProfiler`, `BenchmarkSnapshots`, `BenchmarkChannel`, `ConsoleChannel`, `latencyRange`, `shouldBenchmarkError`; "time this operation", "profile a slow service", "emit p50/p95/p99 metrics", "classify latency against thresholds"; typical import `import { measure, BenchmarkProfiler } from "@warlock.js/core"`. Skip: retry composition — `@warlock.js/core/retry-operation/SKILL.md`; benchmark config wiring — `@warlock.js/core/configure-app/SKILL.md`; competing libs `prom-client`, `pino`, `perf_hooks`, `console.time`.'
---

# Warlock — benchmark code

`measure()` is the workhorse. It wraps any sync-or-async function, captures its latency, classifies it against an excellent/poor band, calls your hooks, and returns a tagged result. Around it, two optional accumulators: `BenchmarkProfiler` (percentiles across many calls) and `BenchmarkSnapshots` (raw error captures for post-mortem).

## The shape

```ts
import { measure } from "@warlock.js/core";

const result = await measure("db.findUser", () => db.users.findOne({ id }));

if (result.success) {
  console.log(result.value);          // T
  console.log(result.latency);        // ms
  console.log(result.state);          // "excellent" | "good" | "poor"
} else {
  console.error(result.error);
}
```

`measure()` always *returns* — it never re-throws. The return type is `BenchmarkSuccessResult<T> | BenchmarkErrorResult`, discriminated by `result.success`. The one exception: `shouldBenchmarkError` returning false re-throws (see below).

## `BenchmarkResult` — what you get back

Both success and error results share:

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

## `latencyRange` — classifying speed

Pass thresholds to get a `state` you can route on:

```ts
await measure("db.findUser", () => db.users.findOne({ id }), {
  latencyRange: { excellent: 100, poor: 500 },
});

// latency <= 100ms  → state: "excellent"
// 100ms < lat < 500 → state: "good"
// latency >= 500ms  → state: "poor"
```

Without `latencyRange`, every successful result is `"good"` and every error is `"poor"`. Set it globally in `src/config/benchmark.ts` (see `BenchmarkConfigurations`) and `measure()` will fall back to that — no need to repeat it per call.

## Hooks

Three optional callbacks, called in order — `onComplete`/`onError` first (one of them, never both), then `onFinish` (always):

```ts
await measure("send-email", () => mailer.send(payload), {
  latencyRange: { excellent: 200, poor: 2000 },
  onComplete: (result) => metrics.record(result.latency),
  onError: (result) => logger.error("email failed", result.error),
  onFinish: (result) => logger.info(`${result.name} → ${result.state}`),
});
```

`tags` rides along on the result and is yours to use however:

```ts
await measure("http.outbound", () => fetch(url), {
  tags: { service: "stripe", endpoint: "/charges" },
});
```

## Selective error capture — `shouldBenchmarkError`

Business errors (4xx, validation) are not infrastructure problems and shouldn't pollute your latency stats. Return `false` to *re-throw* the error without producing a benchmark result:

```ts
await measure("create-user", () => createUser(input), {
  shouldBenchmarkError: (err) => !(err instanceof ValidationError),
});
```

Default is `true` — every thrown error becomes a `BenchmarkErrorResult`.

## `enabled: false` — pass-through

Wrapping costs almost nothing (one `performance.now()`, one closure), but if you want a literal no-op for a hot path:

```ts
const result = await measure("hot-path", () => work(), { enabled: false });
// result.latency === 0
// result.state   === "excellent"
// no hooks fire
```

`fn()` still runs and its return value still lands in `result.value`. The wrapper just skips timing and hooks.

## `BenchmarkProfiler` — rolling percentiles

For high-volume operations where you want p50/p95/p99 rather than per-call hooks:

```ts
import { BenchmarkProfiler, ConsoleChannel, measure } from "@warlock.js/core";

const profiler = new BenchmarkProfiler({
  maxSamples: 1000,                  // ring buffer per operation name
  channels: [new ConsoleChannel()],  // where stats go on flush()
  flushEvery: 60_000,                // auto-flush every minute
});

for (let i = 0; i < 5; i++) {
  await measure(
    "db.findUser",
    () => db.users.findOne({ id: i }),
    { profiler, latencyRange: { excellent: 50, poor: 300 } },
  );
}

const stats = profiler.stats("db.findUser");
// { p50, p90, p95, p99, avg, min, max, count, errors, errorRate, firstSeenAt, lastSeenAt }
```

`profiler.flush()` (manual or auto) hands `allStats()` to every registered `BenchmarkChannel`. The built-in `ConsoleChannel` prints a `console.table` per operation. `NoopChannel` is the default — useful when you want stats accessible via `profiler.stats(name)` without external emission.

Wire a profiler globally through `BenchmarkConfigurations.profiler` in `src/config/benchmark.ts` so every `measure()` call records by default.

### Custom channel

```ts
import type { BenchmarkChannel, BenchmarkStats } from "@warlock.js/core";

export class DatadogChannel implements BenchmarkChannel {
  public async onFlush(stats: Record<string, BenchmarkStats>): Promise<void> {
    for (const [name, operationStats] of Object.entries(stats)) {
      await datadog.gauge(`latency.${name}.p95`, operationStats.p95);
    }
  }
}
```

Pass it via `channels: [new DatadogChannel()]`.

## `BenchmarkSnapshots` — raw captures

When percentiles aren't enough — you need the actual failing inputs/errors for a post-mortem:

```ts
import { BenchmarkSnapshots, measure } from "@warlock.js/core";

const snapshots = new BenchmarkSnapshots({
  maxSnapshots: 100,
  capture: "error",        // "error" (default, safe) | "value" | "all"
});

await measure("payment.charge", () => stripe.charge(payload), { snapshotContainer: snapshots });

const failed = snapshots.getSnapshots("payment.charge");
// array of full BenchmarkErrorResult — error, latency, startedAt, tags
```

`capture: "value"` and `"all"` store the success return value in memory — fine for low-volume diagnostics, dangerous in production. The "error" default keeps memory bounded by the failure rate.

## Globals via `src/config/benchmark.ts`

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

Every `measure()` call without an explicit `latencyRange`/`profiler` falls back to these. Per-call options always win.

## Common patterns

### Measure a service call

```ts
const result = await measure("create-order", () => createOrderService(input));

if (!result.success) {
  return response.badRequest({ error: t("order.failed") });
}

return response.successCreate({ order: result.value });
```

### Measure an external HTTP request

```ts
const result = await measure(
  "stripe.charge",
  () => stripe.charges.create({ amount, currency, source }),
  {
    latencyRange: { excellent: 200, poor: 3000 },
    tags: { gateway: "stripe" },
    shouldBenchmarkError: (err) => err instanceof NetworkError,
  },
);
```

### Compose with `retry()`

```ts
import { measure } from "@warlock.js/core";
import { retry } from "@mongez/reinforcements";

await measure("publish-event", () =>
  retry(() => bus.publish(event), { attempts: 4, delay: 200 }),
);
```

The `latency` is the *total* time including retries — useful for the SLO you actually care about. (`retry` moved to `@mongez/reinforcements`; `count` is now `attempts` — total tries.)

## Gotchas

- **Name collisions aggregate.** Two calls to `measure("foo", …)` share one profiler bucket. Make `name` specific (`db.findUser`, not `db.query`) so percentiles mean something.
- **`measure()` doesn't propagate AbortSignal.** If `fn` is cancellable, plumb that through yourself — the wrapper only times.
- **Don't `measure()` synchronous trivia.** A `Math.round` call isn't worth a microsecond of overhead. Reserve for things that *can* be slow.
- **Snapshots with `"value"` retain references.** If `value` holds a request stream or a large buffer, you've kept it in memory until eviction.
- **`shouldBenchmarkError` re-throws.** Make sure the caller is ready for that, or set it conservatively (`true` by default).

## See also

- [`retry-operation/SKILL.md`](../retry-operation/SKILL.md) — wrapping flaky operations with retry; composes inside `measure()`.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — wiring `src/config/benchmark.ts`.
