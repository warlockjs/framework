import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * The Grok models on xAI's model page, as of {@link XAI_MODEL_LIFECYCLE_AS_OF}.
 * xAI lists no retirement date or deprecation for any language model there,
 * so all of them are `current`. The older Grok 4, 3 and 2 ids are not
 * listed on that page, and no status is claimed for them.
 *
 * Source: https://docs.x.ai/docs/models
 */
export const XAI_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "grok-4.7": { status: "current" },
  "grok-4.6": { status: "current" },
  "grok-4.5": { status: "current" },
  "grok-4.3": { status: "current" },
  "grok-4.20-0309-reasoning": { status: "current" },
  "grok-4.20-0309-non-reasoning": { status: "current" },
  "grok-4.20-multi-agent-0309": { status: "current" },
  "grok-build-0.1": { status: "current" },
};

/** The date {@link XAI_MODEL_LIFECYCLE} was last checked against xAI's model page. */
export const XAI_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of a Grok model id (exact match), or `undefined`
 * when the table does not cover it.
 *
 * @example
 * xaiLifecycleFor("grok-4.3"); // { status: "current" }
 */
export function xaiLifecycleFor(modelName: string): ModelLifecycle | undefined {
  return Object.hasOwn(XAI_MODEL_LIFECYCLE, modelName) ? XAI_MODEL_LIFECYCLE[modelName] : undefined;
}
