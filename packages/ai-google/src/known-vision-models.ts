/**
 * Substrings identifying Gemini model ids whose family accepts image
 * input (vision).
 *
 * Every Gemini 1.5, 2.x, and 2.5 model is natively multimodal, as is
 * the legacy `gemini-pro-vision`. Only the original text-only
 * `gemini-pro` / `gemini-1.0-pro` is excluded. A substring match
 * tolerates the date/preview suffixes Google appends
 * (`gemini-2.5-flash-preview-05-20`). Override per-model via
 * `google.model({ name, vision: true | false })`.
 */
const VISION_CAPABLE_SUBSTRINGS = [
  "gemini-1.5",
  "gemini-2",
  "gemini-exp",
  "gemini-pro-vision",
  "gemini-flash",
];

/**
 * Infer whether a Gemini model id supports vision based on the known
 * multimodal-family substrings. Unknown ids default to `false` so
 * passing an image attachment to an unsupported model surfaces a
 * clear, agent-side capability error instead of an opaque Gemini 400.
 *
 * @example
 * inferVisionCapability("gemini-2.5-flash");          // → true
 * inferVisionCapability("gemini-1.5-pro-002");        // → true
 * inferVisionCapability("gemini-1.0-pro");            // → false
 * inferVisionCapability("text-embedding-004");        // → false
 */
export function inferVisionCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
