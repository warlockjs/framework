import type { BaseReport } from "@warlock.js/ai";
import type { CollectorContract } from "../contracts/collector.contract";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import { walkSpans } from "../exporters/utils/walk-spans";
import type { ContentCaptureOptions } from "./content-capture.type";
import { reportToTrace } from "./report-to-trace";

/**
 * Notified when a registered exporter throws during `collect` / `flush` /
 * `shutdown`. The failure stays isolated (the originating run never sees
 * it) — this is purely a chance to surface it (route to your logger,
 * bump a metric). Receives the exporter's `name` and the thrown error.
 */
export type ExporterErrorHandler = (exporterName: string, error: unknown) => void;

/** Options for {@link createCollector}. */
export type CollectorOptions = ContentCaptureOptions & {
  /**
   * Called when an exporter throws (and is isolated). Overrides the default
   * one-time `console.warn` per exporter — route the failure to your own
   * logger / metrics instead. Errors thrown by the handler itself are
   * swallowed so observability never crashes the run.
   */
  onError?: ExporterErrorHandler;
};

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
 * agent loop nor stop sibling exporters from receiving the trace. The
 * failure is still **surfaced** — via the `onError` option, or a one-time
 * `console.warn` per exporter — so a misconfiguration (e.g. a missing
 * optional peer like `langfuse`) doesn't fail silently.
 */
class Collector implements CollectorContract {
  /**
   * Registered exporters in insertion order. A `Map` keyed by
   * `ExporterContract.name` gives O(1) dedupe on `use` while preserving
   * registration order for deterministic fan-out.
   */
  private readonly exporters = new Map<string, ExporterContract>();

  /**
   * Exporters already warned about on the default error path — so a
   * persistent misconfiguration surfaces once, not on every trace.
   */
  private readonly warnedExporters = new Set<string>();

  /**
   * Collector options: content capture threaded into every `toTrace`
   * projection (`captureContent` populates span `input` / `output`), plus
   * an optional `onError` for isolated exporter failures.
   */
  public constructor(private readonly options: CollectorOptions = {}) {}

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
    const runs = [...this.exporters.entries()].map(([name, exporter]) =>
      Promise.resolve()
        .then(() => task(exporter))
        .catch((error: unknown) => this.reportExporterError(name, error)),
    );

    await Promise.allSettled(runs);
  }

  /**
   * Surface an isolated exporter failure. The originating run never sees it
   * (the isolation guarantee holds), but a silent failure is the wrong
   * default for a config error — e.g. a missing optional peer like
   * `langfuse` would otherwise drop every trace with no signal. The
   * supplied `onError` is called, or — by default — a `console.warn` is
   * emitted ONCE per exporter so the cause is visible without spamming.
   */
  private reportExporterError(name: string, error: unknown): void {
    if (this.options.onError) {
      try {
        this.options.onError(name, error);
      } catch {
        // Never let the error handler itself escape into the run.
      }
      return;
    }

    if (this.warnedExporters.has(name)) {
      return;
    }

    this.warnedExporters.add(name);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[panoptic] exporter "${name}" failed and was isolated: ${message}`);
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
export function createCollector(options: CollectorOptions = {}): CollectorContract {
  return new Collector(options);
}
