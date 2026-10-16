---
name: query-traces
description: 'Retain @warlock.js/ai-panoptic traces in a queryable store — in-memory, or cache-backed so they survive a process restart — and slice them after the fact: get one run by id, list a session, filter failed runs in a window, roll up usage + cost. Triggers: `createInMemoryTraceStore`, `createCacheTraceStore`, `CacheTraceStoreHandle`, `CacheTraceStoreOptions`, `CacheDriverInput`, `store.ready`, `TraceStoreContract`, `TraceQuery`, `TraceAggregate`, `InMemoryTraceStoreOptions`, `store.query`, `store.aggregate`, `store.get`, `store.add`, `store.clear`, `store.size`, `capacity`, `prefix`, `onError`, `sumUsage`, `emptyUsage`, `matchTrace`; ''query collected traces'', ''aggregate AI cost per session'', ''how much did this session spend'', ''list failed runs'', ''retain traces in memory'', ''persist traces across a restart'', ''cache-backed trace store'', ''Redis trace store'', ''roll up token usage''; typical import `import { createInMemoryTraceStore, createCacheTraceStore } from "@warlock.js/ai-panoptic"`. Skip: sending traces to an external backend (OTel/Langfuse/console/file) — the `export-traces` topic; wiring the subscriber into a run — the `observe-with-panoptic` topic.'
---

# Query traces — the in-memory queryable store

The collector fans every completed `Trace` out to its exporters. A **trace store** is one such sink that _retains_ traces so you can answer observability questions after the fact: pull one run by id, list every run for a session, slice failed runs in a time window, or roll usage + cost across any of those slices.

`createInMemoryTraceStore()` returns an object that satisfies **both** `TraceStoreContract` and `ExporterContract` — so wiring it into a collector is a single `collector.use(store)` and the store fills as traces complete.

```ts
import { panoptic, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();

// The store doubles as an exporter — register it like any other sink.
const observe = panoptic({ exporters: [store] });

const agent = ai.agent({ model });
observe.attach(agent);

await agent.execute("Summarize this");

// ...later, off the hot path:
const failed = store.query({ status: "failed" });
const spend = store.aggregate({ sessionId: "session-42" });
```

> The store is also a valid `collector.use(...)` target directly — `panoptic({ collector: createCollector().use(store) })` — see the `observe-with-panoptic` topic for bring-your-own-collector wiring.

## The store contract

`TraceStoreContract` is the queryable surface; the in-memory implementation adds the `ExporterContract` `name` + `export` so it can be a sink.

```ts
interface TraceStoreContract {
  add(trace: Trace): void; // ingest; overwrites same traceId
  get(traceId: string): Trace | undefined; // one run by id
  query(filter?: TraceQuery): Trace[]; // matching traces, newest-started first
  aggregate(filter?: TraceQuery): TraceAggregate; // usage + cost + status rollup
  readonly size: number; // retained count
  clear(): void; // drop everything
}
```

- **`add` overwrites** any existing trace with the same `traceId` — re-collecting a run replaces rather than duplicates it.
- **`export(trace)` is an alias for `add`** — that is what makes the store a drop-in exporter (`store.name === "in-memory-trace-store"`).
- **`query` returns newest-started first** (sorted by root `startedAt`, descending). An empty / omitted filter returns every retained trace.

## Filtering with `TraceQuery`

Every field is optional and **ANDed** together — an absent field is "don't care", so `{}` matches everything. The same filter type drives both `query` and `aggregate`.

```ts
type TraceQuery = {
  traceId?: string; // exact one run
  sessionId?: string; // every run for a session
  status?: ReportStatus | ReportStatus[]; // single status or membership set
  startedAfter?: string | Date; // inclusive lower bound on root startedAt
  startedBefore?: string | Date; // inclusive upper bound on root startedAt
};
```

```ts
// One run by id:
store.query({ traceId: "run-abc" });

// Every run for a conversation:
store.query({ sessionId: "session-42" });

// Failed or cancelled runs since midnight (status accepts an array):
store.query({
  status: ["failed", "cancelled"],
  startedAfter: "2026-06-18T00:00:00.000Z",
});

// A Date works anywhere a time bound is accepted:
store.query({ startedAfter: new Date(Date.now() - 3_600_000) }); // last hour
```

Time bounds compare against each trace's root `startedAt`, **inclusive on both ends**, accepting either an ISO-8601 string or a `Date`. Status is exact equality (or array membership). The pure matcher behind this is `matchTrace(trace, filter)` — exported for testing or filtering a trace list you hold yourself.

## Rolling up with `aggregate`

`aggregate(filter?)` answers the headline questions — how many runs, how many tokens, how much did it cost, how many failed — for whatever slice the filter selects:

```ts
type TraceAggregate = {
  traces: number; // matched count
  completed: number; // root status === "completed"
  failed: number; // root status === "failed"
  cancelled: number; // root status === "cancelled"
  usage: Usage; // summed token usage (input/output/total always present)
  cost?: ModelPricing; // merged per-channel USD, or undefined if no trace was priced
  totalDuration: number; // summed wall-clock ms
};
```

```ts
const stats = store.aggregate({ sessionId: "session-42" });

console.log(`${stats.traces} runs, ${stats.usage.total} tokens, ${stats.failed} failed`);

const totalUsd =
  (stats.cost?.input ?? 0) +
  (stats.cost?.output ?? 0) +
  (stats.cost?.cachedInput ?? 0) +
  (stats.cost?.cachedOutput ?? 0);
```

Notes that matter when reading the numbers:

- **`usage`** sums each trace's _root_ `Usage` (already a rollup of own cost + children), so the totals reflect the whole run tree without re-walking spans. `input` / `output` / `total` are always present (zero when nothing matched); the optional `cachedTokens` / `cacheWriteTokens` / `reasoningTokens` channels are summed only when at least one matched trace reported them.
- **`cost`** is a per-channel `ModelPricing` breakdown (not one opaque number), merged with the framework's own cost-rollup logic — an unpriced trace never erases the cost of priced ones. It stays `undefined` only when **no** matched trace carried pricing.
- **`completed` + `failed` + `cancelled` need not equal `traces`** — non-terminal statuses (`awaiting-input`, `max-iterations`) count toward `traces` but none of the three headline counters.
- An empty match returns a zeroed aggregate (`usage` all `0`, `cost` `undefined`, `totalDuration` `0`).

## Bounding retention with `capacity`

Unbounded by default (keep everything until `clear()`). For a long-lived process, cap it — the oldest-ingested trace is evicted FIFO once the cap is exceeded:

```ts
type InMemoryTraceStoreOptions = { capacity?: number }; // absent / 0 = unbounded

const store = createInMemoryTraceStore({ capacity: 1000 });
```

Overwriting an existing `traceId` refreshes its insertion position, so a re-collected run is treated as newest for eviction — eviction stays honest under overwrite.

> The in-memory store has no secondary indexes: `get` / `add` are O(1), `query` / `aggregate` are O(n) scans. That is the right trade-off for dev/test and modest-volume runtime use. For high-volume or durable retention, write a custom `TraceStoreContract` (or export to a backend with the `export-traces` topic) backed by a real datastore.

## Persisting across a restart — `createCacheTraceStore`

The in-memory store loses everything when the process exits. `createCacheTraceStore(cache, options?)` is a **durable** `TraceStoreContract` (and `ExporterContract`) backed by any `@warlock.js/cache` `CacheDriver` — Redis, file, Postgres, … — so traces survive a restart and the dashboard re-opens with history intact.

```ts
import { createCacheTraceStore } from "@warlock.js/ai-panoptic";
import { RedisCacheDriver } from "@warlock.js/cache";

// A driver instance, or a (possibly async) FACTORY resolved lazily on first
// use — the factory form defers the Redis connect until the first trace is
// collected, so module import stays connection-free.
const store = createCacheTraceStore(async () => {
  const driver = new RedisCacheDriver();
  await driver.connect();
  return driver;
});

await store.ready(); // hydrate the in-memory mirror from a prior run
collector.use(store); // fills as traces complete; reads stay synchronous

const failed = store.query({ status: "failed" }); // queryable like any store
```

**Write-through over a sync contract.** The store keeps the same insertion-ordered in-memory **mirror** the in-memory store uses and serves every read (`get` / `query` / `aggregate` / `size`) from it synchronously — the dashboard polls these and can't await a cache. Writes go **through**: `add` updates the mirror immediately, then _fire-and-forget_ persists the trace + a newest-first index to the cache. So:

- **Reads never wait on the cache** — the mirror is the runtime source of truth; the cache is the durable backing store.
- **A flaky cache never throws into the hot path** — a rejected write is routed to the optional `onError` hook and swallowed; the trace stays visible in the mirror for the life of the process, it just won't survive a restart.
- **`ready()` re-hydrates** the mirror from the persisted index on startup (await it once — `ai.config({ panoptic: { cache } })` does this for you before serving the dashboard).

```ts
type CacheDriverInput =
  | CacheDriver // a live driver
  | (() => CacheDriver | Promise<CacheDriver>); // lazy (sync or async) factory

type CacheTraceStoreOptions = {
  prefix?: string; // key namespace; per-trace keys `${prefix}:trace:${id}`,
  // index at `${prefix}:index`. Default "panoptic".
  capacity?: number; // FIFO cap (oldest-ingested evicted from cache + mirror);
  // absent / 0 = unbounded.
  onError?: (error: unknown) => void; // swallowed cache-write failures land here.
};

type CacheTraceStoreHandle = TraceStoreContract &
  ExporterContract & {
    ready(): Promise<void>; // hydrate the mirror from the cache on startup
  };
```

Ordering uses an **internal monotonic counter**, not `Date.now()`, so the persisted index stays a stable total order even when many traces land in the same millisecond — FIFO eviction stays honest across a restart.

> The usual path is declarative: `ai.config({ panoptic: { cache, dashboard: true } })` constructs this store, awaits `ready()`, and wires it under the dashboard for you — see the `use-local-dashboard` topic. Reach for `createCacheTraceStore` directly only when you manage the store / collector yourself.

## Summing usage yourself

`sumUsage` / `emptyUsage` are the pure folds `aggregate` is built on — reuse them to roll a `Usage` set the store didn't produce (e.g. a list of traces you filtered by hand):

```ts
import { emptyUsage, sumUsage } from "@warlock.js/ai-panoptic";

let total = emptyUsage(); // { input: 0, output: 0, total: 0 } — optional channels absent
for (const trace of store.query({ sessionId })) {
  total = sumUsage(total, trace.usage);
}
```

`sumUsage` is pure (returns a fresh `Usage`, mutates neither argument): token channels always sum; the optional cache/reasoning channels sum only when a side reported them (so a never-metered channel stays absent rather than fabricating a `0`); `cost` merges with the framework's `accumulateCost` so an unpriced contributor never erases a priced one.

## See also

- The `observe-with-panoptic` topic — wiring the `panoptic(...)` subscriber and bring-your-own-collector so the store fills as runs complete.
- The `export-traces` topic — sending traces to an external backend instead of (or alongside) retaining them in memory; writing a custom sink.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — the `BaseReport` the collector projects into the `Trace` this store retains.
