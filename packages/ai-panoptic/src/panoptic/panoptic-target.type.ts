import type { BaseReport, BaseResult } from "@warlock.js/ai";

/**
 * The minimal completed-event payload Panoptic reads off any primitive's
 * terminal `*.completed` event. Every core `@warlock.js/ai` primitive
 * (agent, workflow, supervisor) emits a `*.completed` event carrying the
 * full `result` — and the result always carries a `report` tree — even
 * when the run failed (`agent.error` / `workflow.error` fire first, then
 * `*.completed` still fires). Reading the report off this single event is
 * therefore enough to capture every run regardless of outcome.
 */
export type CompletedEventPayload = {
  /** The finalized result of the run; carries the full `report` tree. */
  result: BaseResult & { report: BaseReport };
};

/**
 * Structural shape of anything Panoptic can subscribe to — the
 * `on(event, handler)` surface shared verbatim by every core
 * `@warlock.js/ai` primitive (`AgentContract`, `WorkflowInstance`,
 * `SupervisorContract`, `OrchestratorContract`).
 *
 * Kept intentionally structural (not an import of the concrete
 * contracts) so {@link panoptic} attaches to any of the four primitives
 * — and to user-defined executables that mirror the same surface —
 * without Panoptic taking a hard dependency on each primitive's exact
 * event-map generics. `on` returns an unsubscribe function in the core,
 * so the subscriber can detach cleanly.
 *
 * @example
 * // Every primitive satisfies this:
 * const agent = ai.agent({ model });
 * const sub = panoptic({ exporters: [consoleExporter()] });
 * const detach = sub.attach(agent); // agent is a PanopticTarget
 */
export type PanopticTarget = {
  /**
   * Stable identifier of the primitive. Used only for diagnostics
   * (Panoptic never branches behavior on it). Present on every core
   * primitive instance.
   */
  readonly name?: string;
  /**
   * Subscribe a handler to a single event name for the lifetime of the
   * instance, returning an unsubscribe function. Mirrors the core 3-tier
   * model's instance tier (`agent.on(...)`, `workflow.on(...)`, …).
   */
  on(event: string, handler: (payload: unknown) => void): () => void;
};
