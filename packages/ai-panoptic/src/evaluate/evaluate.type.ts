import type { JudgeOutcome, ModelContract } from "@warlock.js/ai";

/**
 * Enables the dashboard's per-trace "Evaluate system prompt" action — the
 * drawer's only write-capable feature. Grades the LAST `{role: "system"}`
 * message captured on a span's `input` (requires `captureContent`) against
 * `instructions`, via the same LLM-as-judge machinery `ai.prompts().validate()`
 * uses ({@link import("@warlock.js/ai").judgePromptBody}).
 *
 * Absent `evaluate` ⇒ the dashboard's write route (`POST
 * {basePath}api/traces/:traceId/spans/:spanId/evaluate`) 405s like any other
 * route and the drawer never renders the button — the dashboard stays fully
 * read-only by default.
 *
 * @example
 * ai.config({
 *   panoptic: {
 *     dashboard: {
 *       evaluate: { model: openai.model("gpt-4o-mini"), instructions: "Must address the user by name." },
 *     },
 *   },
 * });
 */
export type EvaluateConfig = {
  /**
   * The judge model, or a (possibly async) factory resolved on first use —
   * the factory form defers construction (e.g. an SDK client) until the
   * first evaluate click. Resolved fresh on every request (evaluate is a
   * deliberate, infrequent, human-triggered action — not the collector's
   * hot path — so no memoization).
   */
  model: ModelContract | (() => ModelContract | Promise<ModelContract>);
  /**
   * Default grading rubric/criteria, verbatim (a single string) — the same
   * `criteria` shape `ai.prompts().validate({ criteria })` accepts. Seeds
   * the dashboard's editable instructions textarea; the built-in
   * prompt-quality rubric is used when neither this nor a per-run override
   * is supplied.
   */
  instructions?: string;
};

/** The judge verdict returned by the evaluate endpoint — `{@link JudgeOutcome}` verbatim. */
export type EvaluateVerdict = JudgeOutcome;
