/**
 * Where a model stands with its vendor: `current` is served and not
 * scheduled for removal, `retiring` is served until `retiresOn`, and
 * `retired` no longer answers (or is rerouted) at the vendor.
 */
export type ModelLifecycleStatus = "current" | "retiring" | "retired";

/**
 * Lifecycle of one model id, as the vendor documented it on the table's
 * `asOf` date. The provider packages export a table of these per provider
 * (for example `OPENAI_MODEL_LIFECYCLE`) so a model picker or a startup
 * check can warn before a model disappears.
 *
 * @example
 * const lifecycle: ModelLifecycle = {
 *   status: "retiring",
 *   retiresOn: "2026-12-11",
 *   replacement: "gpt-5.6-sol",
 * };
 */
export type ModelLifecycle = {
  status: ModelLifecycleStatus;
  /** ISO date (`YYYY-MM-DD`) the vendor stops serving the model, when it published one. */
  retiresOn?: string;
  /** Model id the vendor recommends instead. */
  replacement?: string;
};
