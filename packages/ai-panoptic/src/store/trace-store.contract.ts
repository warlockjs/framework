import type { Trace } from "../contracts/trace.type";
import type { TraceAggregate } from "./trace-aggregate.type";
import type { TraceQuery } from "./trace-query.type";

/**
 * Contract for a Panoptic trace store — a queryable sink that retains
 * collected {@link Trace}s so an app can answer observability questions
 * after the fact: pull one run by id, list every run for a session,
 * slice failed runs in a time window, or roll usage + cost across any
 * of those slices.
 *
 * A store is itself a valid place for a `Collector` to fan out to: the
 * in-memory implementation ({@link import("./in-memory-trace-store").createInMemoryTraceStore})
 * doubles as an `ExporterContract`, so wiring it into a collector is a
 * single `collector.use(store)` and the store fills as traces complete.
 *
 * **Retention is the implementation's concern.** This contract makes no
 * promise about durability or eviction — the in-memory store keeps
 * everything until `clear`, bounded only by an optional capacity cap.
 *
 * @example
 * const store = createInMemoryTraceStore();
 * collector.use(store);
 * // later:
 * const failed = store.query({ status: "failed" });
 * const spend = store.aggregate({ sessionId });
 */
export interface TraceStoreContract {
  /**
   * Ingest one finalized trace. Replaces any existing trace with the
   * same `traceId` (re-collecting a run overwrites rather than
   * duplicates).
   */
  add(trace: Trace): void;

  /** Retrieve a single trace by its `traceId`, or `undefined` if absent. */
  get(traceId: string): Trace | undefined;

  /**
   * Return every stored trace matching the filter, newest-started
   * first. An empty filter returns all traces.
   */
  query(filter?: TraceQuery): Trace[];

  /**
   * Roll usage + cost (and status counts) across every trace matching
   * the filter. An empty filter aggregates the whole store.
   */
  aggregate(filter?: TraceQuery): TraceAggregate;

  /** Total number of traces currently retained. */
  readonly size: number;

  /** Remove every stored trace. */
  clear(): void;
}
