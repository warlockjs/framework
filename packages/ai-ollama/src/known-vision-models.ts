/**
 * Substrings identifying Ollama model tags whose family accepts image
 * input (vision).
 *
 * Ollama tags are family-named with optional size/quant suffixes
 * (`llama3.2-vision:11b`, `llava:13b-v1.6`, `qwen2.5-vl:7b`). A
 * substring match tolerates those suffixes. Covers the common
 * multimodal families on the Ollama registry; text-only models
 * (`llama3.1`, `mistral`, `phi3`, `nomic-embed-text`) are excluded.
 * Override per-model via `ollama.model({ name, vision: true | false })`.
 */
const VISION_CAPABLE_SUBSTRINGS = [
  "llava",
  "vision",
  "bakllava",
  "moondream",
  "minicpm-v",
  "qwen2-vl",
  "qwen2.5-vl",
  "llama4",
  "gemma3",
];

/**
 * Infer whether an Ollama model tag supports vision based on the known
 * multimodal-family substrings. Unknown tags default to `false` so
 * passing an image to a text-only local model surfaces a clear,
 * agent-side capability error instead of the image being silently
 * ignored by the model.
 *
 * @example
 * inferVisionCapability("llama3.2-vision:11b"); // → true
 * inferVisionCapability("llava:13b");           // → true
 * inferVisionCapability("llama3.1");            // → false
 * inferVisionCapability("nomic-embed-text");    // → false
 */
export function inferVisionCapability(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
