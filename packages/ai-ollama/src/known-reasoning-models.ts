/**
 * Substrings identifying Ollama model tags whose family emits a
 * reasoning / "thinking" channel before the visible answer.
 *
 * Ollama exposes thinking via the request-side `think` flag and the
 * response-side `message.thinking` string. Only models trained for it
 * honor `think`; sending it to a non-reasoning model is a no-op at best.
 * Tags are family-named with optional size/quant suffixes
 * (`deepseek-r1:7b`, `qwq:32b-preview`), so a substring match tolerates
 * the suffixes. Covers the common reasoning families on the Ollama
 * registry; plain instruct models (`llama3.1`, `mistral`, `phi3`) are
 * excluded. Override per-model via
 * `ollama.model({ name, reasoning: true | false })`.
 */
const REASONING_CAPABLE_SUBSTRINGS = [
  "deepseek-r1",
  "qwq",
  "qwen3",
  "magistral",
  "phi4-reasoning",
  "phi4-mini-reasoning",
  "cogito",
  "smallthinker",
  "exaone-deep",
  "gpt-oss",
];

/**
 * Infer whether an Ollama model tag supports a reasoning / thinking
 * channel based on the known thinking-family substrings. Unknown tags
 * default to `false` so the adapter never sends the `think` flag to a
 * model that cannot honor it (a no-op for plain instruct models).
 *
 * @example
 * inferReasoningCapability("deepseek-r1:7b");  // → true
 * inferReasoningCapability("qwq:32b");          // → true
 * inferReasoningCapability("llama3.1");         // → false
 * inferReasoningCapability("nomic-embed-text"); // → false
 */
export function inferReasoningCapability(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  return REASONING_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
