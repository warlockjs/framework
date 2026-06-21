import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import { matchTrace } from "./match-trace";
import { emptyUsage, sumUsage } from "./sum-usage";
import type { TraceAggregate } from "./trace-aggregate.type";
import type { TraceQuery } from "./trace-query.type";
import type { TraceStoreContract } from "./trace-store.contract";

/**
 * Options for {@link createInMemoryTraceStore}.
 */
export type InMemoryTraceStoreOptions = {
  /**
   * Maximum number of traces to retain. When set and exceeded, the
   * oldest-ingested trace is evicted (insertion-order FIFO) so the
   * store stays bounded for long-lived processes. Absent / `0` =
   * unbounded (keep everything until `clear`).
   */
  capacity?: number;
};

/**
 * In-memory {@link TraceStoreContract} that doubles as an
 * {@link ExporterContract} — register it on a collector
 * (`collector.use(store)`) and it fills as traces complete, then query
 * or aggregate it after the fact.
 *
 * Backed by an insertion-ordered `Map` keyed by `traceId`, giving O(1)
 * `get` / `add` / overwrite and O(n) scans for `query` / `aggregate`
 * (the price of an in-memory store with no secondary indexes — fine for
 * the dev/test and modest-volume runtime use this targets). When a
 * `capacity` is configured, ingesting past the cap evicts the oldest
 * trace.
 *
 * Instantiated fresh per store via {@link createInMemoryTraceStore};
 * callers never see `new`.
 */
class InMemoryTraceStore implements TraceStoreContract, ExporterContract {
  /** Stable exporter id so a collector can dedupe / log this sink. */
  public readonly name = "in-memory-trace-store";

  /**
   * Retained traces keyed by `traceId`. A `Map` preserves insertion
   * order, which is what FIFO eviction and newest-first `query` ordering
   * both rely on.
   */
  private readonly traces = new Map<string, Trace>();

  private readonly capacity: number;

  public constructor(options?: InMemoryTraceStoreOptions) {
    this.capacity = options?.capacity ?? 0;
  }

  public get size(): number {
    return this.traces.size;
  }

  public add(trace: Trace): void {
    // Re-insert so an overwrite also refreshes insertion position —
    // keeps "oldest" honest for FIFO eviction.
    this.traces.delete(trace.traceId);
    this.traces.set(trace.traceId, trace);

    this.evictOverflow();
  }

  /**
   * `ExporterContract.export` — a collector dispatches a completed
   * trace here, which is exactly an `add`. Lets the store be wired into
   * a collector as a sink without an adapter.
   */
  public export(trace: Trace): void {
    this.add(trace);
  }

  public get(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  public query(filter?: TraceQuery): Trace[] {
    const matched: Trace[] = [];

    for (const trace of this.traces.values()) {
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

    for (const trace of this.traces.values()) {
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
    this.traces.clear();
  }

  /**
   * Increment the matching terminal-status counter for one trace.
   * Non-terminal statuses (`awaiting-input`, `max-iterations`) are
   * counted in `traces` but tracked by none of the three headline
   * counters — intentional, those three answer the common
   * "succeeded / errored / aborted" question.
   */
  private countStatus(aggregate: TraceAggregate, trace: Trace): void {
    switch (trace.root.status) {
      case "completed": {
        aggregate.completed += 1;
        break;
      }

      case "failed": {
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
   * underlying insertion order (which eviction depends on) is never
   * disturbed.
   */
  private sortNewestFirst(traces: Trace[]): Trace[] {
    return traces.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  }

  /**
   * Evict oldest-inserted traces until the store is within `capacity`.
   * No-op when unbounded. The `Map` iterator yields keys in insertion
   * order, so the first key is always the oldest.
   */
  private evictOverflow(): void {
    if (this.capacity <= 0) {
      return;
    }

    while (this.traces.size > this.capacity) {
      const oldest = this.traces.keys().next().value;

      if (oldest === undefined) {
        return;
      }

      this.traces.delete(oldest);
    }
  }
}

/**
 * Create an in-memory trace store. Optionally bound it with `capacity`
 * for long-lived processes; leave it unset for dev/test where you want
 * every trace retained.
 *
 * @example
 * const store = createInMemoryTraceStore({ capacity: 1000 });
 * collector.use(store);
 * // later:
 * const recentFailures = store.query({ status: "failed" });
 * const sessionSpend = store.aggregate({ sessionId });
 */
export function createInMemoryTraceStore(options?: InMemoryTraceStoreOptions): TraceStoreContract & ExporterContract {
  return new InMemoryTraceStore(options);
}
