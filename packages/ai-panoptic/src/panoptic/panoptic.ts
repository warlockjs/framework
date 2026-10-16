import type { AgentMiddleware, BaseReport } from "@warlock.js/ai";
import { createCollector } from "../collector/collector";
import type { CollectorContract } from "../contracts/collector.contract";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import { createPanopticMiddleware } from "./panoptic-middleware";
import type { CompletedEventPayload, PanopticTarget } from "./panoptic-target.type";
import type { Panoptic, PanopticOptions } from "./panoptic.type";

/**
 * Terminal `*.completed` events of every core primitive that carries the
 * finalized `result` (and therefore the `report` tree). These fire once
 * per run regardless of outcome — the matching `*.error` event fires
 * first on failure, then `*.completed` still fires — so subscribing here
 * captures completed, failed, and cancelled runs alike.
 *
 * The orchestrator is intentionally absent: its `orchestrator.turn.*`
 * events carry only session identity, not a result. Collect an
 * orchestrator turn via {@link Panoptic.collect} with
 * `result.report` instead.
 */
const DEFAULT_COMPLETED_EVENTS = [
  "agent.completed",
  "workflow.completed",
  "supervisor.completed",
] as const;

/**
 * The Panoptic subscriber — binds a collector + its exporters to the
 * three feed paths (events, middleware, direct). Instantiated via
 * {@link panoptic}; callers never see `new`.
 */
class PanopticSubscriber implements Panoptic {
  public readonly collector: CollectorContract;

  private readonly completedEvents: string[];

  private readonly middlewareName: string;

  public constructor(options: PanopticOptions = {}) {
    this.collector =
      options.collector ??
      createCollector({
        captureContent: options.captureContent,
        redactContent: options.redactContent,
        fullHistory: options.fullHistory,
        onError: options.onError,
      });

    for (const exporter of options.exporters ?? []) {
      this.collector.use(exporter);
    }

    this.completedEvents = options.completedEvents ?? [...DEFAULT_COMPLETED_EVENTS];
    this.middlewareName = options.middlewareName ?? "panoptic";
  }

  public use(exporter: ExporterContract): Panoptic {
    this.collector.use(exporter);

    return this;
  }

  public attach(target: PanopticTarget): () => void {
    const unsubscribes: Array<() => void> = [];

    for (const event of this.completedEvents) {
      const unsubscribe = target.on(event, (payload) => {
        this.handleCompleted(payload);
      });

      unsubscribes.push(unsubscribe);
    }

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }

  public middleware(): AgentMiddleware {
    return createPanopticMiddleware(this.collector, this.middlewareName);
  }

  public async collect(report: BaseReport): Promise<void> {
    await this.collector.collect(report);
  }

  public toTrace(report: BaseReport): Trace {
    return this.collector.toTrace(report);
  }

  public async flush(): Promise<void> {
    await this.collector.flush();
  }

  public async shutdown(): Promise<void> {
    await this.collector.shutdown();
  }

  /**
   * Project one terminal `*.completed` payload's report into the
   * collector. The fan-out is fire-and-forget relative to the emitting
   * run: the core swallows handler errors, the collector isolates
   * exporter failures, and we additionally guard the rejection here so an
   * observability fault never escapes the event handler.
   */
  private handleCompleted(payload: unknown): void {
    const report = readReport(payload);

    if (!report) {
      return;
    }

    // The failing run's typed error lives on the result envelope
    // (`BaseResult.error`), never on the report tree — thread it so a
    // failed root span carries its error type/message.
    const rootError = readResultError(payload);

    void this.collector.collect(report, rootError).catch(() => {
      // Swallow — see the JSDoc above. Never surface on the run.
    });
  }
}

/**
 * Read the envelope error off a primitive's completed-event payload
 * (`{ result: { error } }`). The error rides on the result envelope, not
 * the report tree, so the collector needs it separately to populate a
 * failed root span. Returns `undefined` when the run succeeded.
 */
function readResultError(payload: unknown): unknown {
  const result = (payload as Partial<CompletedEventPayload>)?.result;

  return (result as { error?: unknown })?.error;
}

/**
 * Read the `report` tree off a primitive's completed-event payload.
 * Structural (no concrete-type import) so it accepts every primitive's
 * result subtype; returns `undefined` when the payload isn't the
 * expected `{ result: { report } }` shape.
 */
function readReport(payload: unknown): BaseReport | undefined {
  const result = (payload as Partial<CompletedEventPayload>)?.result;
  const report = (result as { report?: unknown })?.report;

  if (
    typeof report === "object" &&
    report !== null &&
    typeof (report as { runId?: unknown }).runId === "string" &&
    typeof (report as { rootRunId?: unknown }).rootRunId === "string"
  ) {
    return report as BaseReport;
  }

  return undefined;
}

/**
 * Create a Panoptic subscriber — the one-call entry point that wires the
 * observability pipeline. Pass the exporters you want and Panoptic
 * builds a collector, registers them, and hands back a subscriber you can
 * `attach()` to any agent/workflow/supervisor, install as agent
 * `middleware()`, or feed reports to directly with `collect()`.
 *
 * @example
 * // Attach to a primitive's event stream (captures every run):
 * const observe = panoptic({
 *   exporters: [consoleExporter(), otelExporter({ tracerName: "app" })],
 * });
 *
 * const agent = ai.agent({ model });
 * const detach = observe.attach(agent);
 *
 * await agent.execute("Summarize this");
 * // ...later, on shutdown:
 * await observe.shutdown();
 *
 * @example
 * // Or wire it through the agent middleware pipeline:
 * const observe = panoptic({ exporters: [langfuseExporter({ ... })] });
 * const agent = ai.agent({ model, middleware: [observe.middleware()] });
 *
 * @example
 * // Orchestrator turns carry no result-bearing event — collect directly:
 * const result = await orchestrator.execute(input, { sessionId });
 * await observe.collect(result.report);
 */
export function panoptic(options: PanopticOptions = {}): Panoptic {
  return new PanopticSubscriber(options);
}
