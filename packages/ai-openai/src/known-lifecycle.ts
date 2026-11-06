import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Where OpenAI's own deprecation page puts the models in
 * {@link OPENAI_MODEL_PRICING}, as of {@link OPENAI_MODEL_LIFECYCLE_AS_OF}.
 * `retiring` ids work until `retiresOn`; `retired` ids are past their
 * shutdown date but stay priced so stored reports keep their cost.
 *
 * Source: https://developers.openai.com/api/docs/deprecations. Models the
 * page does not mention are `current`. `gpt-4o`, `gpt-4o-mini` and
 * `gpt-5.2` are left out: the page lists only their dated snapshots or
 * variants, so the status of the plain id is not documented.
 */
export const OPENAI_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "gpt-6.1-terra": { status: "current" },
  "gpt-6-cyber": { status: "current" },
  "gpt-6-astra": { status: "current" },
  "gpt-6-luna": { status: "current" },
  "gpt-5.6-terra": { status: "current" },
  "gpt-5.6-luna": { status: "current" },
  "gpt-5.5": { status: "current" },
  "gpt-5.4": { status: "current" },
  "gpt-5.4-mini": { status: "current" },
  "gpt-5.4-nano": { status: "retiring", retiresOn: "2027-04-01", replacement: "gpt-6-luna" },
  "gpt-5.1": { status: "retiring", retiresOn: "2027-04-01", replacement: "gpt-6-sol" },
  "gpt-5": { status: "retiring", retiresOn: "2026-12-11", replacement: "gpt-5.6-sol" },
  "gpt-5-mini": { status: "retiring", retiresOn: "2026-12-11", replacement: "gpt-5.6-terra" },
  "gpt-5-nano": { status: "retiring", retiresOn: "2026-12-11", replacement: "gpt-5.6-luna" },
  o3: { status: "retiring", retiresOn: "2026-12-11", replacement: "gpt-5.6-sol" },
  "gpt-4.1": { status: "retiring", retiresOn: "2027-01-14", replacement: "gpt-6-luna" },
  "gpt-4.1-mini": { status: "retiring", retiresOn: "2027-01-14", replacement: "gpt-6-luna" },
  "gpt-4.1-nano": { status: "retired", retiresOn: "2026-10-23", replacement: "gpt-5.6-luna" },
  "o4-mini": { status: "retired", retiresOn: "2026-10-23", replacement: "gpt-5.6-terra" },
  "o3-mini": { status: "retired", retiresOn: "2026-10-23", replacement: "gpt-5.6-sol" },
  o1: { status: "retired", retiresOn: "2026-10-23", replacement: "gpt-5.6-sol" },
};

/** The date {@link OPENAI_MODEL_LIFECYCLE} was last checked against OpenAI's deprecation page. */
export const OPENAI_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of an OpenAI model id (exact match), or
 * `undefined` when the table does not cover it.
 *
 * @example
 * openAILifecycleFor("o1"); // { status: "retired", retiresOn: "2026-10-23", replacement: "gpt-5.6-sol" }
 */
export function openAILifecycleFor(modelName: string): ModelLifecycle | undefined {
  return Object.hasOwn(OPENAI_MODEL_LIFECYCLE, modelName)
    ? OPENAI_MODEL_LIFECYCLE[modelName]
    : undefined;
}
