import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Lifecycle of the Mistral-hosted ids that Mistral's deprecations page
 * documents with an API id, as of {@link MISTRAL_MODEL_LIFECYCLE_AS_OF}.
 * Ids the page does not document are left out rather than guessed; the
 * `-latest` aliases are not covered.
 *
 * Source: https://docs.mistral.ai/getting-started/models/models_overview/
 * (the page names Mistral Large 4 as the replacement for
 * `mistral-large-2512` and `mistral-medium-3-5` but gives no API id, so no
 * `replacement` is set for them).
 */
export const MISTRAL_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "zai-glm-5-3": { status: "current" },
  "zai-glm-5-2": { status: "retired", retiresOn: "2026-10-31", replacement: "zai-glm-5-3" },
  "mistral-medium-3-5": { status: "retiring", retiresOn: "2027-04-30" },
  "mistral-large-2512": { status: "retiring", retiresOn: "2027-04-30" },
  "mistral-medium-2508": { status: "retired", retiresOn: "2026-08-31" },
  "mistral-small-2506": { status: "retired", retiresOn: "2026-07-31" },
  "devstral-2512": { status: "retired", retiresOn: "2026-07-31" },
  "magistral-medium-2509": { status: "retired", retiresOn: "2026-07-31" },
  "magistral-small-2509": { status: "retired", retiresOn: "2026-07-31" },
  "open-mistral-nemo-2407": { status: "retired", retiresOn: "2026-07-31" },
};

/** The date {@link MISTRAL_MODEL_LIFECYCLE} was last checked against Mistral's model page. */
export const MISTRAL_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of a Mistral model id (exact match), or
 * `undefined` when the table does not cover it.
 *
 * @example
 * mistralLifecycleFor("zai-glm-5-2"); // { status: "retired", retiresOn: "2026-10-31", replacement: "zai-glm-5-3" }
 */
export function mistralLifecycleFor(modelName: string): ModelLifecycle | undefined {
  return Object.hasOwn(MISTRAL_MODEL_LIFECYCLE, modelName)
    ? MISTRAL_MODEL_LIFECYCLE[modelName]
    : undefined;
}
