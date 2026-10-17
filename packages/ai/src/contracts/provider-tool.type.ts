/**
 * A provider-defined (built-in) tool: a tool definition the provider itself
 * understands, sent to that provider verbatim instead of being converted
 * from a framework `ToolConfig`.
 *
 * Two kinds exist and both use this shape:
 *
 * - **Server-run tools** — the provider executes them and returns the
 *   results inside the same response (Anthropic `web_search` /
 *   `web_fetch` / `code_execution`, OpenAI Responses `web_search` /
 *   `file_search` / `code_interpreter`, Gemini `googleSearch` /
 *   `codeExecution` / `urlContext`, Bedrock `systemTool`s).
 * - **Client-run tools with a provider schema** — the provider defines the
 *   input shape, the model calls them like any tool, and your code runs
 *   them (Anthropic `bash` / `text_editor` / `memory`). Give
 *   `ai.providerTool()` an `execute` for these.
 *
 * `provider` selects who receives the definition: the adapter's wire
 * format (`"anthropic"`, `"openai"`, `"google"`, `"bedrock"`) or the
 * model's provider label (`"groq"`, `"xai"`, …, for OpenAI-compatible
 * vendors). Every other adapter skips the entry and logs a warning.
 *
 * @example
 * const webSearch: ProviderToolDefinition = {
 *   provider: "anthropic",
 *   definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
 * };
 */
export type ProviderToolDefinition = {
  /** Provider (wire format or provider label) that receives this definition. */
  provider: string;
  /** The tool entry exactly as that provider's API expects it; sent verbatim. */
  definition: Record<string, unknown>;
};
