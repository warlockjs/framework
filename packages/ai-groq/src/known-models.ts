/**
 * Default base URL for Groq's OpenAI-compatible Chat Completions
 * endpoint. Groq exposes the same wire protocol as OpenAI under this
 * prefix, which is exactly why `GroqSDK` can delegate to the
 * battle-tested `OpenAISDK` instead of reimplementing the transport.
 *
 * Verified against Groq's "OpenAI Compatibility" docs (mid-2026).
 * Override via `new GroqSDK({ baseURL })` if Groq ever relocates it.
 */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * The provider label every model produced by `GroqSDK` self-identifies
 * with. Flows through to `ModelContract.provider`, `AgentReport.model`,
 * logs, and any provider-aware middleware. Kept as a constant so the
 * wrapper and the inner `OpenAISDK` agree on one spelling.
 */
export const GROQ_PROVIDER = "groq";

/**
 * Substrings identifying Groq-hosted model ids whose family accepts
 * image input (vision).
 *
 * Groq hosts *open* models on its LPU hardware, so the ids are the
 * upstream open-weight names rather than OpenAI's — which is why the
 * OpenAI adapter's `gpt-4o*` prefix inference would never fire here and
 * this provider must carry its OWN list. Verified against Groq's
 * supported-models catalog (mid-2026):
 *
 * - `openai/gpt-oss-*` — natively multimodal OpenAI open-weight family
 *   (the current production vision + reasoning models on Groq).
 * - `llama-4` / `llama-3.2-*-vision` — Meta's multimodal Llama families.
 *   Kept as substrings so any still-hosted or re-introduced variant is
 *   covered even though some `llama-4` ids were deprecated in 2026.
 *
 * Matched as a substring (not a prefix) because Groq prefixes several
 * ids with an org segment (`openai/`, `meta-llama/`) and appends size /
 * date suffixes. Override per-model via
 * `groq.model({ name, vision: true | false })`.
 */
const VISION_CAPABLE_SUBSTRINGS = [
  "gpt-oss",
  "llama-4",
  "llama-3.2-11b-vision",
  "llama-3.2-90b-vision",
  "vision",
];

/**
 * Substrings identifying Groq-hosted model ids that expose an internal
 * reasoning / thinking channel and accept the `reasoning_effort`
 * request parameter on the OpenAI-compatible Chat Completions endpoint.
 *
 * Verified against Groq's catalog (mid-2026):
 * - `gpt-oss` — the OpenAI open-weight family reasons by default.
 * - `deepseek-r1-distill` — DeepSeek-R1-style reasoning at Groq speed.
 * - `qwq` / `qwen3` — Qwen reasoning families (when hosted).
 *
 * Matched as a substring for the same org-prefix / suffix reason as the
 * vision list. Override per-model via
 * `groq.model({ name, reasoning: true | false })`.
 */
const REASONING_CAPABLE_SUBSTRINGS = [
  "gpt-oss",
  "deepseek-r1",
  "deepseek-r1-distill",
  "qwq",
  "qwen3",
];

/**
 * Infer whether a Groq-hosted model id supports vision based on the
 * known multimodal-family substrings. Unknown ids default to `false`
 * so passing an image attachment to a text-only model (e.g.
 * `llama-3.3-70b-versatile`) surfaces a clear, agent-side capability
 * error instead of an opaque upstream 400.
 *
 * @example
 * inferVisionCapability("openai/gpt-oss-120b");        // → true
 * inferVisionCapability("meta-llama/llama-4-scout");   // → true
 * inferVisionCapability("llama-3.3-70b-versatile");    // → false
 * inferVisionCapability("llama-3.1-8b-instant");       // → false
 */
export function inferVisionCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Infer whether a Groq-hosted model id is a reasoning model based on
 * the known reasoning-family substrings. Unknown ids default to `false`
 * so the adapter never forwards an unsupported `reasoning_effort` param
 * to a non-reasoning model (which would 400).
 *
 * @example
 * inferReasoningCapability("openai/gpt-oss-20b");           // → true
 * inferReasoningCapability("deepseek-r1-distill-llama-70b"); // → true
 * inferReasoningCapability("llama-3.3-70b-versatile");      // → false
 */
export function inferReasoningCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return REASONING_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Curated list of current Groq production chat model ids (mid-2026),
 * for autocomplete, docs, and default selection. NOT exhaustive and NOT
 * a runtime allow-list — `groq.model({ name })` accepts any string, so
 * a newly launched id works the moment Groq ships it without a package
 * bump. Deprecated ids (e.g. several `llama-4` variants retired in 2026)
 * are intentionally excluded.
 *
 * - `llama-3.3-70b-versatile` — flagship general-purpose text model.
 * - `llama-3.1-8b-instant` — fastest/cheapest small text model.
 * - `openai/gpt-oss-120b` / `openai/gpt-oss-20b` — OpenAI open-weight
 *   family; vision + reasoning capable.
 * - `deepseek-r1-distill-llama-70b` — DeepSeek-R1-style reasoning.
 */
export const GROQ_KNOWN_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "deepseek-r1-distill-llama-70b",
] as const;
