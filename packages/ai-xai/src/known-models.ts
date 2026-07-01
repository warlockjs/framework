/**
 * Capability inference for xAI Grok model ids.
 *
 * xAI speaks the OpenAI Chat Completions protocol, so the wire-level
 * adapter is `OpenAISDK`. But Grok model names (`grok-4`,
 * `grok-2-vision`, …) don't match OpenAI's `gpt-*` / `o*` prefixes, so
 * OpenAI's own inference lists would mis-classify every Grok model as
 * non-vision / non-reasoning. This module supplies xAI's OWN name lists
 * and the `XaiSDK` wrapper injects the resulting capability flags into
 * each `OpenAIModelConfig` before delegating, so the right capabilities
 * are set even though the names aren't OpenAI names.
 *
 * All lists are matched as a prefix so dated / `-latest` / `-fast`
 * variants (`grok-4-0709`, `grok-2-vision-latest`,
 * `grok-3-mini-beta`) are covered without enumerating every release
 * tag. Devs can always override per-model via
 * `xai.model({ name, vision: true | false, reasoning: true | false })`
 * — explicit config wins over inference in either direction.
 */

/**
 * Model-name prefixes for Grok families that accept image input
 * (vision) on the OpenAI-compatible Chat Completions endpoint.
 *
 * - `grok-4` is natively multimodal (text + image input).
 * - `grok-2-vision` is the dedicated image-understanding Grok 2 model.
 *
 * Text-only families (`grok-3`, `grok-3-mini`, the base `grok-2`
 * text model) are intentionally excluded so passing an image
 * attachment to them surfaces a clear, agent-side capability error
 * rather than an opaque xAI 400.
 */
export const XAI_VISION_MODEL_PREFIXES = ["grok-4", "grok-2-vision"] as const;

/**
 * Model-name prefixes for Grok families that expose internal reasoning
 * and accept reasoning controls (e.g. `reasoning_effort`) on the
 * OpenAI-compatible Chat Completions endpoint.
 *
 * - `grok-4` is a reasoning-first model (it always reasons).
 * - `grok-3-mini` is the "think" variant of Grok 3 and reasons; the
 *   full-size `grok-3` does not, so it is deliberately NOT covered by
 *   the `grok-3-mini` prefix.
 */
export const XAI_REASONING_MODEL_PREFIXES = ["grok-4", "grok-3-mini"] as const;

/**
 * A convenience list of the current public Grok chat model ids, handy
 * for menus, validation, and docs. Not exhaustive of every dated alias
 * xAI publishes — pass any id through `xai.model({ name })`; the prefix
 * inference above handles dated / `-latest` variants.
 *
 * @example
 * XAI_CHAT_MODELS.includes("grok-4");          // → true
 */
export const XAI_CHAT_MODELS = [
  "grok-4",
  "grok-3",
  "grok-3-mini",
  "grok-2-vision",
  "grok-2",
] as const;

/**
 * Infer whether a given Grok model id supports vision based on xAI's
 * known-prefix list. Unknown ids default to `false` so that passing an
 * image attachment to an unsupported model surfaces a clear,
 * agent-side capability error instead of an opaque xAI 400.
 *
 * @example
 * inferVisionCapability("grok-4");                 // → true
 * inferVisionCapability("grok-2-vision-latest");   // → true
 * inferVisionCapability("grok-3");                 // → false
 * inferVisionCapability("grok-3-mini");            // → false
 */
export function inferVisionCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return XAI_VISION_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Infer whether a given Grok model id is a reasoning model based on
 * xAI's known-prefix list. Unknown ids default to `false` so the
 * adapter never forwards an unsupported reasoning param to a
 * non-reasoning model.
 *
 * @example
 * inferReasoningCapability("grok-4");          // → true
 * inferReasoningCapability("grok-3-mini");     // → true
 * inferReasoningCapability("grok-3");          // → false
 * inferReasoningCapability("grok-2-vision");   // → false
 */
export function inferReasoningCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return XAI_REASONING_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
