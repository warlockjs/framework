/**
 * Capability inference for DeepSeek chat model ids.
 *
 * DeepSeek's API is OpenAI-compatible on the wire (`@warlock.js/ai-deepseek`
 * wraps {@link OpenAISDK}), but its model **names** are not OpenAI names —
 * so OpenAI's own prefix lists (`gpt-4o`, `o3`, …) never match them. This
 * module supplies DeepSeek's OWN name-based inference, which the
 * {@link DeepSeekSDK} injects as explicit capability booleans into the
 * wrapped `openai.model(...)` call (explicit config wins over OpenAI's
 * inference inside `OpenAIModel`).
 *
 * Verified against the official DeepSeek API docs (api-docs.deepseek.com,
 * mid-2026): base URL `https://api.deepseek.com`, OpenAI-compatible Chat
 * Completions. Two reasoning-capable surfaces exist — the legacy
 * `deepseek-reasoner` (thinking mode) and the `*-pro` tier — while
 * `deepseek-chat` is the non-thinking surface. No DeepSeek chat model
 * documents image (vision) input, so vision inference is conservatively
 * `false` for every id.
 */

/**
 * Default DeepSeek chat model ids, surfaced for discovery and docs.
 *
 * - `deepseek-chat` — the non-thinking surface (V3 lineage). Fast, cheap,
 *   broad production coverage. Not reasoning-capable.
 * - `deepseek-reasoner` — the thinking surface (R1 lineage). Emits a
 *   reasoning channel and accepts the reasoning-effort knob.
 *
 * Both legacy names are scheduled for retirement (2026/07/24 per DeepSeek's
 * deprecation notice) in favor of the `deepseek-v4-*` family
 * (`deepseek-v4-flash`, `deepseek-v4-pro`), which this inference also
 * understands. The list is informational only — `deepseek.model({ name })`
 * accepts any id the upstream serves.
 */
export const DEEPSEEK_CHAT_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
] as const;

/**
 * Substrings identifying DeepSeek model ids that expose a reasoning /
 * thinking channel and accept the reasoning-effort knob.
 *
 * - `deepseek-reasoner` — the dedicated thinking surface (R1 lineage).
 * - `-pro` — the V4 quality tier (`deepseek-v4-pro`), which thinks by
 *   default per DeepSeek's docs.
 *
 * `deepseek-chat` (the V3 non-thinking surface) and `deepseek-v4-flash`
 * stay `false`. A substring match tolerates date/preview suffixes the
 * provider may append. Override per-model via
 * `deepseek.model({ name, reasoning: true | false })`.
 */
const REASONING_CAPABLE_SUBSTRINGS = ["deepseek-reasoner", "-pro"];

/**
 * Infer whether a DeepSeek model id is reasoning-capable based on the
 * known substrings. Unknown ids default to `false` so the adapter never
 * forwards an unsupported reasoning param to a non-thinking model.
 *
 * @example
 * inferReasoningCapability("deepseek-reasoner");  // → true
 * inferReasoningCapability("deepseek-v4-pro");     // → true
 * inferReasoningCapability("deepseek-chat");        // → false
 * inferReasoningCapability("deepseek-v4-flash");    // → false
 */
export function inferReasoningCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return REASONING_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Substrings identifying DeepSeek model ids that accept image (vision)
 * input.
 *
 * Currently **empty**: as of mid-2026, no DeepSeek chat model documents
 * vision input on the OpenAI-compatible Chat Completions endpoint, so
 * inference returns `false` for every id and passing an image attachment
 * surfaces a clear, agent-side capability error instead of an opaque 400.
 * Append a fragment here (and a paired spec case) the day DeepSeek ships a
 * multimodal chat model. Devs can always opt in per-model via
 * `deepseek.model({ name, vision: true })`.
 */
const VISION_CAPABLE_SUBSTRINGS: readonly string[] = [];

/**
 * Infer whether a DeepSeek model id supports vision based on the known
 * substrings. Today this is always `false` (see
 * {@link VISION_CAPABLE_SUBSTRINGS}); kept as a function so the
 * {@link DeepSeekSDK} call site and the override semantics stay identical
 * to the other adapters, ready for a future multimodal id.
 *
 * @example
 * inferVisionCapability("deepseek-chat");      // → false
 * inferVisionCapability("deepseek-reasoner");  // → false
 */
export function inferVisionCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
