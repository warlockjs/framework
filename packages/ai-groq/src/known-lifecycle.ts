import type { ModelLifecycle } from "@warlock.js/ai";

/**
 * Where Groq's deprecations page and model catalog put the chat models the
 * adapter knows, as of {@link GROQ_MODEL_LIFECYCLE_AS_OF}. `retired` ids
 * are past their shutdown date; Groq applies several of these shutdowns to
 * free and developer-tier usage only, so a committed-spend enterprise
 * contract can still serve them.
 *
 * Sources: https://console.groq.com/docs/deprecations and
 * https://console.groq.com/docs/models. Preview models (`qwen/qwen3.8-27b`,
 * `openai/gpt-oss-safeguard-20b`) are listed as `current` while Groq
 * serves them, but Groq may discontinue previews at short notice.
 */
export const GROQ_MODEL_LIFECYCLE: Readonly<Record<string, ModelLifecycle>> = {
  "openai/gpt-oss-120b": { status: "current" },
  "openai/gpt-oss-20b": { status: "current" },
  "openai/gpt-oss-safeguard-20b": { status: "current" },
  "qwen/qwen3.8-27b": { status: "current" },
  "llama-3.3-70b-versatile": {
    status: "retired",
    retiresOn: "2026-08-16",
    replacement: "openai/gpt-oss-120b",
  },
  "llama-3.1-8b-instant": {
    status: "retired",
    retiresOn: "2026-08-16",
    replacement: "openai/gpt-oss-20b",
  },
  "deepseek-r1-distill-llama-70b": {
    status: "retired",
    retiresOn: "2025-10-02",
    replacement: "openai/gpt-oss-120b",
  },
  "qwen/qwen3.6-27b": {
    status: "retired",
    retiresOn: "2026-09-14",
    replacement: "qwen/qwen3.8-27b",
  },
  "qwen/qwen3-32b": {
    status: "retired",
    retiresOn: "2026-07-17",
    replacement: "openai/gpt-oss-120b",
  },
  "meta-llama/llama-4-scout-17b-16e-instruct": {
    status: "retired",
    retiresOn: "2026-07-17",
    replacement: "openai/gpt-oss-120b",
  },
  "meta-llama/llama-4-maverick-17b-128e-instruct": {
    status: "retired",
    retiresOn: "2026-03-09",
    replacement: "openai/gpt-oss-120b",
  },
  "moonshotai/kimi-k2-instruct-0905": {
    status: "retired",
    retiresOn: "2026-04-15",
    replacement: "openai/gpt-oss-120b",
  },
  "moonshotai/kimi-k2-instruct": {
    status: "retired",
    retiresOn: "2025-10-10",
    replacement: "openai/gpt-oss-120b",
  },
  "groq/compound": { status: "retired", retiresOn: "2026-09-21" },
  "groq/compound-mini": { status: "retired", retiresOn: "2026-09-21" },
};

/** The date {@link GROQ_MODEL_LIFECYCLE} was last checked against Groq's deprecations page. */
export const GROQ_MODEL_LIFECYCLE_AS_OF = "2026-11-06";

/**
 * Look up the lifecycle of a Groq model id (exact match), or `undefined`
 * when the table does not cover it.
 *
 * @example
 * groqLifecycleFor("llama-3.3-70b-versatile"); // { status: "retired", retiresOn: "2026-08-16", … }
 */
export function groqLifecycleFor(modelName: string): ModelLifecycle | undefined {
  return Object.hasOwn(GROQ_MODEL_LIFECYCLE, modelName)
    ? GROQ_MODEL_LIFECYCLE[modelName]
    : undefined;
}
