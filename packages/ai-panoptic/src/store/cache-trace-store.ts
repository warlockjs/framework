import type { CacheDriver } from "@warlock.js/cache";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import { matchTrace } from "./match-trace";
import { emptyUsage, sumUsage } from "./sum-usage";
import type { TraceAggregate } from "./trace-aggregate.type";
import type { TraceQuery } from "./trace-query.type";
import type { TraceStoreContract } from "./trace-store.contract";

/**
 * A {@link CacheDriver} instance, or a (possibly async) factory that
 * yields one on first use. The factory form lets production defer an
 * expensive connect (e.g. the Redis handshake) until the first trace is
 * actually written, and keeps the dashboard wiring free of a live driver
 * at module-import time.
 *
 * Typed `CacheDriver<any, any>` because the store only ever touches the
 * driver's `get` / `set` / `remove` surface and is agnostic to the
 * concrete client + options of whichever driver backs it.
 */
export type CacheDriverInput =
  // The store is driver-agnostic; it only uses get/set/remove, so the
  // concrete client/options generics are intentionally unconstrained.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | CacheDriver<any, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | (() => CacheDriver<any, any> | Promise<CacheDriver<any, any>>);

/**
 * Options for {@link createCacheTraceStore}.
 */
export type CacheTraceStoreOptions = {
  /**
   * Key prefix every cache entry this store writes is namespaced under.
   * Per-trace keys are `${prefix}:trace:${traceId}`; the newest-first
   * index lives at `${prefix}:index`. Default `"panoptic"`.
   */
  prefix?: string;
  /**
   * Maximum number of traces to retain. When set and exceeded, the
   * oldest-ingested trace is evicted from both the cache and the in-memory
   * mirror (insertion-order FIFO). Absent / `0` = unbounded.
   */
  capacity?: number;
};

/** One entry in the persisted newest-first index. */
type IndexEntry = {
  /** The trace's `traceId` — the suffix of its `${prefix}:trace:` key. */
  id: string;
  /**
   * Monotonic insertion order from an internal counter — NOT a wall clock.
   * Used only to keep the index in stable insertion order across a restart
   * so FIFO eviction stays honest.
   */
  addedAt: number;
};

const DEFAULT_PREFIX = "panoptic";

/**
 * Cache-backed {@link TraceStoreContract} with a **write-through** design
 * that reconciles the synchronous store contract with an asynchronous
 * cache driver.
 *
 * **How the sync/async tension is resolved.** The contract's `get` /
 * `query` / `aggregate` / `size` are synchronous (the dashboard polls them
 * on every request and the in-memory store answers instantly). A cache
 * driver is async. So this store keeps an **in-memory read mirror** — the
 * same insertion-ordered `Map<traceId, Trace>` the in-memory store uses —
 * and serves every read from it synchronously. Writes go **through** to the
 * cache: `add` updates the mirror immediately, then asynchronously persists
 * the trace + index to the cache (errors are swallowed via an optional
 * `onError` hook so a flaky cache never throws into the collector's hot
 * path). On process restart, {@link CacheTraceStore.ready} re-hydrates the
 * mirror from the cache so traces survive the restart.
 *
 * **Durability is best-effort.** Reads never wait on the cache; the mirror
 * is the source of truth at runtime and the cache is the durable backing
 * store. A write that the cache rejects is still visible in the mirror for
 * the life of the process — it just won't survive a restart.
 *
 * **Lazy driver resolution.** The driver (or its async factory) is resolved
 * on first use and memoized, so a production deployment can defer the Redis
 * connect until the first trace is collected, and the dashboard can be
 * wired with a factory at import time without a live connection.
 *
 * Doubles as an {@link ExporterContract} (`export` ≡ `add`), so it drops
 * straight into a collector via `collector.use(store)`.
 *
 * Instantiated via {@link createCacheTraceStore}; callers never see `new`.
 */
class CacheTraceStore implements TraceStoreContract, ExporterContract {
  /** Stable exporter id so a collector can dedupe / log this sink. */
  public readonly name = "cache-trace-store";

  /**
   * In-memory read mirror keyed by `traceId`. A `Map` preserves insertion
   * order, which newest-first `query` ordering and FIFO eviction both rely
   * on. Every read is served from here synchronously.
   */
  private readonly mirror = new Map<string, Trace>();

  private readonly prefix: string;

  private readonly capacity: number;

  /**
   * Monotonic insertion counter — the source of `IndexEntry.addedAt`.
   * Deliberately NOT `Date.now()`: an internal counter guarantees a stable
   * total order for the index even when many traces land in the same
   * millisecond.
   */
  private addCounter = 0;

  /** The optional input — a driver, a factory, or `undefined`. */
  private readonly input: CacheDriverInput;

  // The store is driver-agnostic; only get/set/remove are used.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolvedDriver?: CacheDriver<any, any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private driverPending?: Promise<CacheDriver<any, any>>;

  private readonly onError?: (error: unknown) => void;

  public constructor(
    input: CacheDriverInput,
    options: CacheTraceStoreOptions & { onError?: (error: unknown) => void } = {},
  ) {
    this.input = input;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.capacity = options.capacity ?? 0;
    this.onError = options.onError;
  }

  public get size(): number {
    return this.mirror.size;
  }

  /**
   * Hydrate the in-memory mirror from the cache. Idempotent-safe to call
   * once at startup (the dashboard / config wiring awaits it). Reads the
   * persisted index, fetches each referenced trace, and replays them into
   * the mirror in insertion order so newest-first ordering + eviction stay
   * correct after a restart. A cache failure is routed to `onError` and
   * leaves the mirror empty rather than throwing.
   */
  public async ready(): Promise<void> {
    try {
      const driver = await this.resolveDriver();
      const index = await driver.get<IndexEntry[]>(this.indexKey());

      if (!Array.isArray(index)) {
        return;
      }

      // Oldest-first replay so the mirror's insertion order matches the
      // original ingestion order.
      const ordered = [...index].sort((left, right) => left.addedAt - right.addedAt);

      for (const entry of ordered) {
        const trace = await driver.get<Trace>(this.traceKey(entry.id));

        if (trace !== null && trace !== undefined) {
          this.mirror.delete(trace.traceId);
          this.mirror.set(trace.traceId, trace);
        }

        if (entry.addedAt >= this.addCounter) {
          this.addCounter = entry.addedAt + 1;
        }
      }

      this.evictOverflow();
    } catch (error) {
      this.reportError(error);
    }
  }

  public add(trace: Trace): void {
    // Mirror update is synchronous and authoritative for runtime reads.
    this.mirror.delete(trace.traceId);
    this.mirror.set(trace.traceId, trace);

    const addedAt = this.addCounter;
    this.addCounter += 1;

    const evicted = this.evictOverflow();

    // Write through to the cache fire-and-forget; reads never wait on this.
    void this.persist(trace, addedAt, evicted);
  }

  /**
   * `ExporterContract.export` — a collector dispatches a completed trace
   * here, which is exactly an `add`.
   */
  public export(trace: Trace): void {
    this.add(trace);
  }

  public get(traceId: string): Trace | undefined {
    return this.mirror.get(traceId);
  }

  public query(filter?: TraceQuery): Trace[] {
    const matched: Trace[] = [];

    for (const trace of this.mirror.values()) {
      if (matchTrace(trace, filter)) {
        matched.push(trace);
      }
    }

    return this.sortNewestFirst(matched);
  }

  public aggregate(filter?: TraceQuery): TraceAggregate {
    const aggregate: TraceAggregate = {
      traces: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      usage: emptyUsage(),
      totalDuration: 0,
    };

    for (const trace of this.mirror.values()) {
      if (!matchTrace(trace, filter)) {
        continue;
      }

      aggregate.traces += 1;
      aggregate.totalDuration += trace.duration;
      aggregate.usage = sumUsage(aggregate.usage, trace.usage);

      this.countStatus(aggregate, trace);
    }

    if (aggregate.usage.cost !== undefined) {
      aggregate.cost = aggregate.usage.cost;
    }

    return aggregate;
  }

  public clear(): void {
    const ids = [...this.mirror.keys()];
    this.mirror.clear();

    void this.purge(ids);
  }

  /**
   * Persist one trace + the rebuilt index to the cache, optionally removing
   * a trace evicted by the capacity cap. Best-effort: any cache failure is
   * routed to `onError`, never thrown — the mirror already reflects the
   * write so runtime reads are unaffected.
   */
  private async persist(
    trace: Trace,
    addedAt: number,
    evictedId: string | undefined,
  ): Promise<void> {
    try {
      const driver = await this.resolveDriver();

      await driver.set(this.traceKey(trace.traceId), trace);

      if (evictedId !== undefined) {
        await driver.remove(this.traceKey(evictedId));
      }

      await driver.set(this.indexKey(), this.buildIndex(addedAt));
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Best-effort removal of every persisted trace + the index on `clear`. */
  private async purge(ids: string[]): Promise<void> {
    try {
      const driver = await this.resolveDriver();

      for (const id of ids) {
        await driver.remove(this.traceKey(id));
      }

      await driver.remove(this.indexKey());
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Rebuild the newest-first index from the current mirror. The mirror's
   * `Map` iteration is oldest-first insertion order; we walk it and assign
   * `addedAt` from the surviving counter span so the persisted order
   * matches the in-memory one. The freshest entry uses `latestAddedAt`.
   */
  private buildIndex(latestAddedAt: number): IndexEntry[] {
    const ids = [...this.mirror.keys()];
    const base = latestAddedAt - (ids.length - 1);

    return ids.map((id, offset) => ({ id, addedAt: base + offset }));
  }

  /**
   * Resolve the driver once and memoize. Supports a bare driver, a sync
   * factory, and an async factory. Concurrent first-callers share one
   * in-flight resolution.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async resolveDriver(): Promise<CacheDriver<any, any>> {
    if (this.resolvedDriver !== undefined) {
      return this.resolvedDriver;
    }

    if (this.driverPending !== undefined) {
      return this.driverPending;
    }

    const candidate =
      typeof this.input === "function"
        ? (
            this.input as () =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              | CacheDriver<any, any>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              | Promise<CacheDriver<any, any>>
          )()
        : this.input;

    this.driverPending = Promise.resolve(candidate);

    try {
      this.resolvedDriver = await this.driverPending;

      return this.resolvedDriver;
    } finally {
      this.driverPending = undefined;
    }
  }

  /** `${prefix}:trace:${traceId}` — the per-trace cache key. */
  private traceKey(traceId: string): string {
    return `${this.prefix}:trace:${traceId}`;
  }

  /** `${prefix}:index` — the newest-first index cache key. */
  private indexKey(): string {
    return `${this.prefix}:index`;
  }

  /** Route a swallowed cache error to the optional handler. */
  private reportError(error: unknown): void {
    if (this.onError !== undefined) {
      this.onError(error);
    }
  }

  /**
   * Increment the matching terminal-status counter for one trace.
   * Mirrors the in-memory store: non-terminal statuses are counted in
   * `traces` but tracked by none of the three headline counters.
   */
  private countStatus(aggregate: TraceAggregate, trace: Trace): void {
    switch (trace.root.status) {
      case "completed": {
        aggregate.completed += 1;
        break;
      }

      // An incomplete agent run (its answer was cut off) errored.
      case "failed":
      case "incomplete": {
        aggregate.failed += 1;
        break;
      }

      case "cancelled": {
        aggregate.cancelled += 1;
        break;
      }

      default: {
        break;
      }
    }
  }

  /**
   * Sort matched traces newest-started first. A copy is sorted so the
   * mirror's insertion order (which eviction depends on) is never disturbed.
   */
  private sortNewestFirst(traces: Trace[]): Trace[] {
    return traces.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  }

  /**
   * Evict oldest-inserted traces from the mirror until within `capacity`.
   * Returns the id of the single evicted trace (the common case — one `add`
   * pushes at most one over the cap) so the caller can remove it from the
   * cache too. No-op + `undefined` when unbounded or within the cap.
   */
  private evictOverflow(): string | undefined {
    if (this.capacity <= 0) {
      return undefined;
    }

    let evicted: string | undefined;

    while (this.mirror.size > this.capacity) {
      const oldest = this.mirror.keys().next().value;

      if (oldest === undefined) {
        return evicted;
      }

      this.mirror.delete(oldest);
      evicted = oldest;
    }

    return evicted;
  }
}

/**
 * The concrete store type returned by {@link createCacheTraceStore} — the
 * standard {@link TraceStoreContract} + {@link ExporterContract} surface,
 * plus a `ready()` to hydrate the in-memory mirror from the cache on
 * startup so traces survive a process restart.
 */
export type CacheTraceStoreHandle = TraceStoreContract &
  ExporterContract & {
    /**
     * Hydrate the in-memory mirror from the cache. Await once at startup
     * (the dashboard wiring does this for you) so previously-persisted
     * traces are queryable after a restart.
     */
    ready(): Promise<void>;
  };

/**
 * Create a cache-backed trace store. Reads are served synchronously from an
 * in-memory mirror; writes go through to the cache, and {@link
 * CacheTraceStoreHandle.ready} re-hydrates the mirror on startup so traces
 * survive a restart. See {@link CacheTraceStore} for the full write-through
 * design.
 *
 * @param cache a {@link CacheDriver}, or a (possibly async) factory that
 *   yields one on first use — resolved lazily and memoized so a production
 *   Redis connect can be deferred until the first trace is collected.
 * @param options `prefix` (default `"panoptic"`), `capacity` (FIFO cap),
 *   and an optional `onError` hook for swallowed cache write failures.
 *
 * @example
 * import { RedisCacheDriver } from "@warlock.js/cache";
 *
 * // Lazy async factory — defers the Redis connect until first use.
 * const store = createCacheTraceStore(async () => {
 *   const driver = new RedisCacheDriver();
 *   await driver.connect();
 *   return driver;
 * });
 *
 * await store.ready();      // hydrate from a prior run
 * collector.use(store);     // fills as traces complete
 * const failed = store.query({ status: "failed" });
 */
export function createCacheTraceStore(
  cache: CacheDriverInput,
  options: CacheTraceStoreOptions & { onError?: (error: unknown) => void } = {},
): CacheTraceStoreHandle {
  return new CacheTraceStore(cache, options);
}
