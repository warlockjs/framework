import type { BaseReport } from "@warlock.js/ai";
import type { ExporterContract } from "./exporter.contract";
import type { Trace } from "./trace.type";

/**
 * Contract for the Panoptic collector — the source end of the
 * observability pipeline. A collector ingests core `@warlock.js/ai`
 * execution reports (a {@link BaseReport} tree), normalizes them into a
 * {@link Trace}, and fans the result out to every registered
 * {@link ExporterContract}.
 *
 * The collector is the single integration point an app wires into its
 * agents/workflows (typically via the `onComplete` report hook). It
 * owns exporter registration, the report-to-trace projection, and
 * graceful shutdown so exporters drain before exit.
 *
 * @example
 * collector.use(otelExporter).use(langfuseExporter);
 * agent.on("onComplete", (report) => collector.collect(report));
 * // on shutdown:
 * await collector.shutdown();
 */
export interface CollectorContract {
  /**
   * Register an exporter. Returns the collector for chaining. Duplicate
   * registration (same `ExporterContract.name`) is ignored.
   */
  use(exporter: ExporterContract): this;

  /**
   * Ingest one finalized root report, project it into a {@link Trace},
   * and dispatch it to every registered exporter. Resolves once all
   * exporters have been invoked; individual exporter failures are
   * isolated and never propagate back into the originating run.
   *
   * `rootError` threads the failing run's envelope error (`BaseResult.error`)
   * onto the root span — the error lives on the result envelope, not on the
   * `BaseReport` tree, so a failed root would otherwise carry `status` with
   * no error type/message. Applied only when the root span has none of its
   * own.
   */
  collect(report: BaseReport, rootError?: unknown): Promise<void>;

  /**
   * Pure projection of a report tree into a {@link Trace}, exposed so
   * callers can inspect or test the normalized shape without dispatching
   * to exporters. `collect` uses this internally. `rootError` threads the
   * envelope error onto the root span exactly as in {@link collect}.
   */
  toTrace(report: BaseReport, rootError?: unknown): Trace;

  /**
   * Flush every registered exporter that supports it. Useful between
   * batches or before a checkpoint.
   */
  flush(): Promise<void>;

  /**
   * Flush and shut down every registered exporter, then release the
   * collector. Call once during process teardown.
   */
  shutdown(): Promise<void>;
}
