/**
 * Substrings that identify Bedrock model ids whose family accepts image
 * input on the Converse API.
 *
 * Bedrock model ids are provider-prefixed and version-suffixed
 * (`anthropic.claude-3-5-sonnet-20240620-v1:0`, `us.amazon.nova-pro-v1:0`,
 * `meta.llama3-2-90b-instruct-v1:0`), so a substring match is the only
 * robust check across the cross-region inference-profile prefixes
 * (`us.`, `eu.`, `apac.`) and date/version tags.
 *
 * Multimodal families covered: Anthropic Claude 3 / 3.5 / 3.7 / 4,
 * Amazon Nova Lite/Pro/Premier, Meta Llama 3.2 (11B/90B) and Llama 4.
 * Text-only families (Llama 3/3.1, Titan Text, Mistral 7B, Cohere
 * Command) are intentionally absent. Override per-model via
 * `bedrock.model({ name, vision: true | false })`.
 */
const VISION_CAPABLE_SUBSTRINGS = [
  "claude-3",
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-haiku-4",
  "nova-lite",
  "nova-pro",
  "nova-premier",
  "llama3-2-11b",
  "llama3-2-90b",
  "llama4",
];

/**
 * Infer whether a Bedrock model id supports vision based on the known
 * multimodal-family substrings. Unknown ids default to `false` so that
 * passing an image attachment to an unsupported model surfaces a clear,
 * agent-side capability error instead of an opaque Bedrock validation
 * fault.
 *
 * @example
 * inferVisionCapability("anthropic.claude-3-5-sonnet-20240620-v1:0"); // → true
 * inferVisionCapability("us.amazon.nova-pro-v1:0");                    // → true
 * inferVisionCapability("meta.llama3-1-8b-instruct-v1:0");             // → false
 * inferVisionCapability("amazon.titan-text-express-v1");               // → false
 */
export function inferVisionCapability(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return VISION_CAPABLE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
