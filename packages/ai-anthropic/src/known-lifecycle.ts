import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Where Anthropic's model-deprecations page puts the models in
 * {@link ANTHROPIC_MODEL_PRICING}, as of {@link ANTHROPIC_MODEL_LIFECYCLE_AS_OF}.
 * Active models carry no `retiresOn`: Anthropic documents only a
 * "not sooner than" date for them.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/model-deprecations
 */
export const ANTHROPIC_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "claude-fable-5-1": { status: "current" },
  "claude-fable-5": { status: "current" },
  "claude-opus-5-5": { status: "current" },
  "claude-opus-5": { status: "current" },
  "claude-opus-4-8": { status: "current" },
  "claude-opus-4-7": { status: "current" },
  "claude-opus-4-6": { status: "current" },
  "claude-opus-4-5": { status: "current" },
  "claude-sonnet-5-5": { status: "current" },
  "claude-sonnet-5": { status: "current" },
  "claude-sonnet-4-6": { status: "current" },
  "claude-sonnet-4-5": {
    status: "retiring",
    retiresOn: "2026-11-30",
    replacement: "claude-sonnet-5-5",
  },
  "claude-haiku-5-5": { status: "current" },
  "claude-haiku-4-5": { status: "current" },
  "claude-opus-4-1": { status: "retired", retiresOn: "2026-08-05", replacement: "claude-opus-4-8" },
  "claude-opus-4": { status: "retired", retiresOn: "2026-06-15", replacement: "claude-opus-4-8" },
  "claude-sonnet-4": {
    status: "retired",
    retiresOn: "2026-06-15",
    replacement: "claude-sonnet-5-5",
  },
  "claude-3-7-sonnet": {
    status: "retired",
    retiresOn: "2026-02-19",
    replacement: "claude-sonnet-5-5",
  },
  "claude-3-5-haiku": {
    status: "retired",
    retiresOn: "2026-02-19",
    replacement: "claude-haiku-4-5",
  },
  "claude-3-haiku": { status: "retired", retiresOn: "2026-04-20", replacement: "claude-haiku-4-5" },
};

/** The date {@link ANTHROPIC_MODEL_LIFECYCLE} was last checked against Anthropic's deprecations page. */
export const ANTHROPIC_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/** A trailing `-YYYYMMDD` snapshot date on a Claude model id. */
const SNAPSHOT_SUFFIX = /-\d{8}$/;

/**
 * Look up the lifecycle of a Claude model id. Accepts the alias
 * (`claude-sonnet-4-5`) or a dated snapshot (`claude-sonnet-4-5-20250929`).
 * Returns `undefined` for an id the table does not cover.
 *
 * @example
 * anthropicLifecycleFor("claude-sonnet-4-5-20250929"); // { status: "retiring", retiresOn: "2026-11-30", … }
 */
export function anthropicLifecycleFor(modelName: string): ModelLifecycle | undefined {
  const id = Object.hasOwn(ANTHROPIC_MODEL_LIFECYCLE, modelName)
    ? modelName
    : modelName.replace(SNAPSHOT_SUFFIX, "");

  return Object.hasOwn(ANTHROPIC_MODEL_LIFECYCLE, id) ? ANTHROPIC_MODEL_LIFECYCLE[id] : undefined;
}
