import type { BaseReport } from "@warlock.js/ai";
import type { CollectorContract } from "../contracts/collector.contract";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import { walkSpans } from "../exporters/utils/walk-spans";
import type { ContentCaptureOptions } from "./content-capture.type";
import { reportToTrace } from "./report-to-trace";

/**
 * Drive the source end of the Panoptic pipeline: ingest core
 * `@warlock.js/ai` {@link BaseReport} trees, project them into {@link
 * Trace}s, and fan each trace out to every registered exporter.
 *
 * Owns exporter registration (deduped by `ExporterContract.name`), the
 * report→trace projection, and graceful shutdown so exporters drain
 * before exit. Instantiated fresh per collector via {@link
 * createCollector}; callers never see `new`.
 *
 * **Failure isolation.** An exporter that throws never propagates back
 * into the originating run — `collect`, `flush`, and `shutdown` settle
 * every exporter independently (mirrors how the core event hooks
 * swallow consumer errors). One broken exporter can neither crash the
 * agent loop nor stop sibling exporters from receiving the trace.
 */
class Collector implements CollectorContract {
  /**
   * Registered exporters in insertion order. A `Map` keyed by
   * `ExporterContract.name` gives O(1) dedupe on `use` while preserving
   * registration order for deterministic fan-out.
   */
  private readonly exporters = new Map<string, ExporterContract>();

  /**
   * Content-capture options threaded into every `toTrace` projection.
   * When `captureContent` is set, projected spans carry `input` /
   * `output`; otherwise they stay metadata-only.
   */
  public constructor(private readonly options: ContentCaptureOptions = {}) {}

  public use(exporter: ExporterContract): this {
    if (!this.exporters.has(exporter.name)) {
      this.exporters.set(exporter.name, exporter);
    }

    return this;
  }

  public toTrace(report: BaseReport, rootError?: unknown): Trace {
    return reportToTrace(report, rootError, this.options);
  }

  public async collect(report: BaseReport, rootError?: unknown): Promise<void> {
    const trace = this.toTrace(report, rootError);

    await this.dispatch(trace);
  }

  public async flush(): Promise<void> {
    await this.settleAll((exporter) => exporter.flush?.());
  }

  public async shutdown(): Promise<void> {
    await this.flush();

    await this.settleAll((exporter) => exporter.shutdown?.());

    this.exporters.clear();
  }

  /**
   * Fan one trace out to every exporter and, when an exporter advertises
   * the per-span hook, deliver every span in the finalized tree to it as
   * well. `exportSpan` is a post-completion per-span hook (not a live /
   * streaming feed — the trace is already finalized): we walk the tree in
   * pre-order with {@link walkSpans} so the exporter sees the root and
   * every descendant exactly once. Every invocation is isolated so a
   * throwing exporter can't abort the dispatch to its siblings or escape
   * into the originating run.
   */
  private async dispatch(trace: Trace): Promise<void> {
    await this.settleAll(async (exporter) => {
      await exporter.export(trace);

      if (exporter.exportSpan !== undefined) {
        for (const span of walkSpans(trace.root)) {
          await exporter.exportSpan(span);
        }
      }
    });
  }

  /**
   * Run `task` against every registered exporter and wait for all of
   * them to settle, swallowing individual rejections. `Promise.allSettled`
   * guarantees one failure neither rejects the batch nor blocks the
   * others — the contract's failure-isolation requirement.
   */
  private async settleAll(
    task: (exporter: ExporterContract) => void | Promise<void>,
  ): Promise<void> {
    const runs = [...this.exporters.values()].map((exporter) => Promise.resolve().then(() => task(exporter)));

    await Promise.allSettled(runs);
  }
}

/**
 * Create a Panoptic collector — the single integration point an app
 * wires into its agents/workflows (typically via the `onComplete`
 * report hook). Register exporters with `use`, then feed finalized root
 * reports to `collect`.
 *
 * @example
 * const collector = createCollector().use(otelExporter).use(langfuseExporter);
 * agent.on("onComplete", ({ result }) => collector.collect(result.report));
 * // on shutdown:
 * await collector.shutdown();
 */
export function createCollector(options: ContentCaptureOptions = {}): CollectorContract {
  return new Collector(options);
}
