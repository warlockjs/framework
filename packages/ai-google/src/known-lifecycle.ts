import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Where Google's deprecations page puts the Gemini text models the
 * adapter knows, as of {@link GOOGLE_MODEL_LIFECYCLE_AS_OF}. A `retiring`
 * model is served until `retiresOn`; Google reroutes `gemini-2.5-pro` and
 * `gemini-2.5-flash` requests to the replacement on that date. `retired`
 * ids were removed or are already rerouted.
 *
 * Source: https://ai.google.dev/gemini-api/docs/deprecations (earliest
 * possible shutdown dates, as Google words them). `gemini-2.5-flash-lite`
 * is left out: the pricing page calls it deprecated while the
 * deprecations page lists no date.
 */
export const GOOGLE_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "gemini-4-argon": { status: "current" },
  "gemini-3.8-flash": { status: "current" },
  "gemini-3.6-flash": { status: "current" },
  "gemini-3.5-flash-lite": { status: "current" },
  "gemini-3.1-pro-preview": { status: "current" },
  "gemini-3-flash-preview": { status: "current", replacement: "gemini-3.6-flash" },
  "gemini-3.1-flash-lite": {
    status: "retiring",
    retiresOn: "2027-05-07",
    replacement: "gemini-3.5-flash-lite",
  },
  "gemini-2.5-pro": { status: "retiring", retiresOn: "2026-12-01", replacement: "gemini-3.8-flash" },
  "gemini-2.5-flash": {
    status: "retiring",
    retiresOn: "2026-12-01",
    replacement: "gemini-3.5-flash-lite",
  },
  "gemini-3.7-flash": { status: "retired", replacement: "gemini-3.8-flash" },
  "gemini-3.5-flash": { status: "retired", replacement: "gemini-3.6-flash" },
  "gemini-3-pro-preview": {
    status: "retired",
    retiresOn: "2026-03-09",
    replacement: "gemini-3.1-pro-preview",
  },
  "gemini-2.0-flash": { status: "retired", retiresOn: "2026-06-01", replacement: "gemini-3.6-flash" },
  "gemini-2.0-flash-lite": {
    status: "retired",
    retiresOn: "2026-06-01",
    replacement: "gemini-3.1-flash-lite",
  },
};

/** The date {@link GOOGLE_MODEL_LIFECYCLE} was last checked against Google's deprecations page. */
export const GOOGLE_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of a Gemini model id (exact match; a leading
 * `models/` is accepted), or `undefined` when the table does not cover it.
 *
 * @example
 * googleLifecycleFor("gemini-2.5-pro"); // { status: "retiring", retiresOn: "2026-12-01", replacement: "gemini-3.8-flash" }
 */
export function googleLifecycleFor(modelName: string): ModelLifecycle | undefined {
  const id = modelName.replace(/^models\//, "");

  return Object.hasOwn(GOOGLE_MODEL_LIFECYCLE, id) ? GOOGLE_MODEL_LIFECYCLE[id] : undefined;
}
