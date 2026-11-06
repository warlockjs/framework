import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Where DeepSeek's docs put its chat model names, as of
 * {@link DEEPSEEK_MODEL_LIFECYCLE_AS_OF}. `deepseek-chat` and
 * `deepseek-reasoner` were retired on 2026-07-24. `deepseek-v4-flash` is
 * retired as a model, but DeepSeek still accepts the name and serves it
 * with `deepseek-flash`, billed at the Flash price; it published no
 * shutdown date for the name.
 *
 * Sources: https://api-docs.deepseek.com/news/news260424 and
 * https://api-docs.deepseek.com/quick_start/pricing
 */
export const DEEPSEEK_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "deepseek-flash": { status: "current" },
  "deepseek-v4-pro": { status: "current" },
  "deepseek-v4-flash": { status: "retired", replacement: "deepseek-flash" },
  "deepseek-chat": { status: "retired", retiresOn: "2026-07-24", replacement: "deepseek-v4-flash" },
  "deepseek-reasoner": {
    status: "retired",
    retiresOn: "2026-07-24",
    replacement: "deepseek-v4-flash",
  },
};

/** The date {@link DEEPSEEK_MODEL_LIFECYCLE} was last checked against DeepSeek's docs. */
export const DEEPSEEK_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of a DeepSeek model id (exact match), or
 * `undefined` when the table does not cover it.
 *
 * @example
 * deepseekLifecycleFor("deepseek-chat"); // { status: "retired", retiresOn: "2026-07-24", … }
 */
export function deepseekLifecycleFor(modelName: string): ModelLifecycle | undefined {
  return Object.hasOwn(DEEPSEEK_MODEL_LIFECYCLE, modelName)
    ? DEEPSEEK_MODEL_LIFECYCLE[modelName]
    : undefined;
}
