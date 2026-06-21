import type { AgentMiddleware, BaseReport } from "@warlock.js/ai";
import type { CollectorContract } from "../contracts/collector.contract";
import type { ExporterContract } from "../contracts/exporter.contract";
import type { Trace } from "../contracts/trace.type";
import type { PanopticTarget } from "./panoptic-target.type";

/**
 * Options for the {@link panoptic} subscriber factory.
 *
 * The common case is `{ exporters: [...] }` — Panoptic creates its own
 * collector and registers the exporters on it. Pass `collector` to reuse
 * a pre-built collector (e.g. one that already has a store registered);
 * any `exporters` supplied are registered onto it as well.
 */
export type PanopticOptions = {
  /**
   * Exporters to register on the collector. Each is deduped by
   * `ExporterContract.name` (registering the same exporter twice is a
   * no-op). Optional — you can also `use()` exporters after construction.
   */
  exporters?: ExporterContract[];
  /**
   * Bring your own collector instead of letting Panoptic create one.
   * When supplied, `exporters` are registered onto it; when omitted,
   * Panoptic calls `createCollector()` internally. Inject this to share
   * one collector across several subscribers or to pre-wire a store.
   */
  collector?: CollectorContract;
  /**
   * Names of the terminal `*.completed` events to subscribe to when
   * {@link Panoptic.attach} is called. Defaults to the completed event of
   * every core primitive — `agent.completed`, `workflow.completed`,
   * `supervisor.completed`. Override to widen/narrow the surface (e.g.
   * attach only to agents). Panoptic subscribes to each name and silently
   * ignores the ones the target doesn't emit.
   */
  completedEvents?: string[];
  /**
   * Stable name reported by the middleware returned from
   * {@link Panoptic.middleware}. Defaults to `"panoptic"`. Override when
   * registering more than one Panoptic middleware on the same agent.
   */
  middlewareName?: string;
};

/**
 * The subscriber returned by {@link panoptic}. Wraps a collector +
 * exporters and offers three ways to feed it:
 *
 * - **{@link Panoptic.attach}** — subscribe to a primitive's terminal
 *   `*.completed` events (the 3-tier model's instance tier) so every run
 *   is captured automatically. Returns a detach function.
 * - **{@link Panoptic.middleware}** — an `AgentMiddleware` that collects
 *   each `agent.execute()` result from the `execute.after` / `onError`
 *   hooks, for apps that prefer the middleware pipeline over events.
 * - **{@link Panoptic.collect}** — feed a `BaseReport` directly (e.g. an
 *   orchestrator turn's `result.report`, which has no result-bearing
 *   completed event).
 *
 * All three converge on the same collector, so a trace flows to every
 * registered exporter exactly once per run.
 */
export type Panoptic = {
  /** The underlying collector — exposed for `use()`, `toTrace()`, etc. */
  readonly collector: CollectorContract;
  /**
   * Register another exporter on the collector. Returns `this` for
   * chaining; mirrors `CollectorContract.use`.
   */
  use(exporter: ExporterContract): Panoptic;
  /**
   * Subscribe to a primitive's terminal completed events so every run it
   * performs is collected automatically. Safe to call on agents,
   * workflows, and supervisors. Returns a detach function that removes
   * every listener this call added.
   */
  attach(target: PanopticTarget): () => void;
  /**
   * An `AgentMiddleware` that feeds the collector from the
   * `execute`-level `after` / `onError` hooks — an alternative to
   * {@link Panoptic.attach} for apps wiring observability through the
   * middleware pipeline. The hooks never mutate the result.
   */
  middleware(): AgentMiddleware;
  /**
   * Feed a finalized root report straight into the collector. Use for
   * primitives whose completed event carries no result (the
   * orchestrator) or to collect a report captured out of band.
   */
  collect(report: BaseReport): Promise<void>;
  /**
   * Pure projection of a report into a {@link Trace} without dispatching
   * — passthrough to `CollectorContract.toTrace`.
   */
  toTrace(report: BaseReport): Trace;
  /** Flush every registered exporter that supports it. */
  flush(): Promise<void>;
  /** Flush and shut down every registered exporter. */
  shutdown(): Promise<void>;
};
