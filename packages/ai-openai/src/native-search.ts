import {
  InvalidRequestError,
  isProviderTool,
  type ModelCallOptions,
  type ProviderToolDefinition,
} from "@warlock.js/ai";

/** Hosted web-search tool types the Responses API accepts. */
const HOSTED_SEARCH_TYPES: ReadonlySet<string> = new Set([
  "web_search",
  "web_search_2025_08_26",
  "web_search_preview",
  "web_search_preview_2025_03_11",
]);

/**
 * Models the OpenAI web-search tool is documented as unavailable on, plus
 * ids that are not conversational at all. Everything else is attempted:
 * an id the list does not know still reaches OpenAI, which is the authority.
 * https://developers.openai.com/api/docs/guides/tools-web-search
 */
const UNSUPPORTED_SEARCH_MODELS =
  /^(?:gpt-3\.5|gpt-4(?:-\d|-turbo|-32k|$)|gpt-4\.1-nano|o1-mini|o1-preview|o3-mini|text-embedding|whisper|tts|dall-e|gpt-image|omni-moderation)/u;

/** The provider-defined entries on a call that belong to `provider`. */
export function providerToolsOf(
  options: ModelCallOptions | undefined,
  provider: string,
): ProviderToolDefinition[] {
  return [...(options?.providerTools ?? []), ...(options?.tools ?? []).filter(isProviderTool)]
    .filter((entry) => entry.provider === provider)
    .map((entry) => entry as ProviderToolDefinition);
}

/** `true` when the call carries OpenAI's hosted web-search tool. */
export function requestsHostedSearch(
  options: ModelCallOptions | undefined,
  provider: string,
): boolean {
  return providerToolsOf(options, provider).some(
    (entry) =>
      typeof entry.definition.type === "string" && HOSTED_SEARCH_TYPES.has(entry.definition.type),
  );
}

/**
 * Throw a capability error, before any request, when a model cannot run
 * OpenAI's hosted web search. Nothing falls back silently: the caller picks
 * another model or drops the tool.
 */
export function assertHostedSearchSupported(
  model: string,
  options: ModelCallOptions | undefined,
): void {
  if (UNSUPPORTED_SEARCH_MODELS.test(model)) {
    throw new InvalidRequestError(
      `OpenAI's hosted web_search tool is not available on "${model}". Use a model that supports it (for example gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-5), or remove the web_search tool.`,
      { context: { provider: "openai", model, tool: "web_search" } },
    );
  }

  if (/^gpt-5/u.test(model) && options?.reasoning?.effort === "minimal") {
    throw new InvalidRequestError(
      `OpenAI's hosted web_search tool is not available on "${model}" with minimal reasoning. Use a higher reasoning effort or remove the web_search tool.`,
      { context: { provider: "openai", model, tool: "web_search", effort: "minimal" } },
    );
  }
}
