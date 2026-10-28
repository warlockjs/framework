import { attachCost, type ModelPricing, type Usage } from "@warlock.js/ai";
import type OpenAI from "openai";

/** Installed openai 7.23.0 ResponseFunctionWebSearch (action includes search/open_page/find).
 * https://developers.openai.com/api/docs/guides/tools-web-search
 * Count output items, never URLs, sources, answer text, or function calls.
 * Fees and search content tokens are separate; preview pricing varies:
 * https://developers.openai.com/api/docs/pricing#built-in-tools */
export function hostedOutput(
  usage: Usage,
  output: OpenAI.Responses.ResponseOutputItem[],
  pricing: ModelPricing | undefined,
  key: string = "openai",
): Record<string, unknown> | undefined {
  const hosted = output.filter(
    (item) => item.type !== "message" && item.type !== "reasoning" && item.type !== "function_call",
  );
  const searches = hosted.filter((item) => item.type === "web_search_call");
  if (searches.length)
    usage.serverToolUse = { ...usage.serverToolUse, webSearchRequests: searches.length };
  attachCost(usage, pricing);
  return hosted.length ? { [key]: { output: hosted } } : undefined;
}
