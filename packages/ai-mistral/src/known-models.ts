import type { ModelPricing } from "@warlock.js/ai";

/**
 * Model-name fragments identifying Mistral families that accept image
 * input (vision / multimodal).
 *
 * - `pixtral` — Mistral's dedicated multimodal family
 *   (`pixtral-large-latest`, `pixtral-12b`); documents, charts, and
 *   natural images.
 * - `mistral-large` / `mistral-medium` — the recent frontier generations
 *   (Large 3, Medium 3.5) are natively multimodal.
 * - `ministral-3` — the current small open-weight line ships with
 *   best-in-class text + vision.
 *
 * Matched as a **substring** (not a strict prefix) so the date / version
 * suffixes Mistral appends (`pixtral-large-2411`, `mistral-large-2512`)
 * and the `-latest` aliases are all covered without enumerating every
 * release tag. Override per-model via
 * `mistral.model({ name, vision: true | false })` — explicit config
 * always wins over inference.
 *
 * Maintenance: append a fragment when Mistral ships a multimodal family
 * that doesn't already match.
 */
const VISION_CAPABLE_SUBSTRINGS = [
  "pixtral",
  "mistral-large",
  "mistral-medium",
  "ministral-3",
] as const;

/**
 * Model-name fragments identifying Mistral families that perform
 * explicit chain-of-thought reasoning.
 *
 * - `magistral` — Mistral's dedicated reasoning family
 *   (`magistral-medium-latest`, `magistral-small-latest`); emits
 *   tokenized thinking chunks.
 * - `mistral-small-4` / `mistral-small` — the current Small generation
 *   is a hybrid model that unifies instruct + reasoning + coding.
 *
 * Matched as a **substring** so version-tagged ids
 * (`magistral-medium-2509`, `mistral-small-2603`) and `-latest` aliases
 * are covered. Override per-model via
 * `mistral.model({ name, reasoning: true | false })` — explicit config
 * always wins over inference.
 *
 * Maintenance: append a fragment when Mistral ships a reasoning family
 * that doesn't already match.
 */
const REASONING_CAPABLE_SUBSTRINGS = ["magistral", "mistral-small"] as const;

/**
 * Infer whether a Mistral model id accepts image input (vision) based on
 * the known multimodal-family fragments. Unknown ids default to `false`
 * so passing an image attachment to a text-only model surfaces a clear,
 * agent-side capability error instead of an opaque Mistral 400.
 *
 * @example
 * inferVisionCapability("pixtral-large-latest");   // → true
 * inferVisionCapability("mistral-large-2512");     // → true
 * inferVisionCapability("magistral-medium-latest");// → false
 * inferVisionCapability("mistral-embed");          // → false
 */
export function inferVisionCapability(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Infer whether a Mistral model id is a reasoning model (the `magistral`
 * family plus the hybrid `mistral-small` generation) based on the known
 * fragments. Unknown ids default to `false` so the adapter never forwards
 * an unsupported `reasoning_effort` param to a non-reasoning model.
 *
 * @example
 * inferReasoningCapability("magistral-medium-latest"); // → true
 * inferReasoningCapability("mistral-small-2603");      // → true
 * inferReasoningCapability("mistral-large-latest");    // → false
 * inferReasoningCapability("pixtral-12b");             // → false
 */
export function inferReasoningCapability(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  return REASONING_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Stable `-latest` alias ids for the headline Mistral chat / embeddings
 * models, grouped by role. Convenience constants only — `mistral.model()`
 * accepts any id string, so a version-pinned id
 * (`mistral-large-2512`, `magistral-medium-2509`) works just as well.
 * Capability inference keys off the family fragment, not this list, so a
 * newer alias is recognized the moment its name matches a fragment in
 * {@link inferVisionCapability} / {@link inferReasoningCapability}.
 */
export const MISTRAL_MODELS = {
  /** General-purpose multimodal flagship / mid / small chat aliases. */
  chat: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  /** Dedicated multimodal (vision) aliases — the `pixtral` family. */
  vision: ["pixtral-large-latest", "pixtral-12b"],
  /** Dedicated reasoning aliases — the `magistral` family. */
  reasoning: ["magistral-medium-latest", "magistral-small-latest"],
  /** Embeddings model reachable via the OpenAI-compatible `/v1/embeddings`. */
  embedding: ["mistral-embed"],
} as const;

/**
 * Conservative default USD pricing registry (per 1,000,000 tokens),
 * keyed by stable `-latest` alias, surfaced onto every model unless the
 * caller overrides it via SDK-level or per-model `pricing`.
 *
 * These are sane published-list approximations for budgeting / cost-truth
 * out of the box — Mistral revises rates and ships new generations, so
 * pass an explicit `pricing` registry to `new MistralSDK({ pricing })`
 * for billing-grade numbers. Resolution at `model()` time always lets a
 * caller-supplied rate win: per-model `pricing` > SDK `pricing` > these
 * defaults > `undefined`.
 */
export const MISTRAL_DEFAULT_PRICING: Record<string, ModelPricing> = {
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-medium-latest": { input: 0.4, output: 2 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  "pixtral-large-latest": { input: 2, output: 6 },
  "pixtral-12b": { input: 0.15, output: 0.15 },
  "magistral-medium-latest": { input: 2, output: 5 },
  "magistral-small-latest": { input: 0.5, output: 1.5 },
  "mistral-embed": { input: 0.1, output: 0 },
};
