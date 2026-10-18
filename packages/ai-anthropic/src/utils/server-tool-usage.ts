import type Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "@warlock.js/ai";

/** Installed @anthropic-ai/sdk 0.129.0 ServerToolUsage and MessageDeltaUsage use the same cumulative counters.
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
 * No code-execution request counter is reported: never count content blocks instead. */
export function applyServerToolUsage(
  usage: Usage,
  raw: Partial<Anthropic.ServerToolUsage> | null | undefined,
): void {
  if (!raw) return;
  usage.serverToolUse = {
    ...usage.serverToolUse,
    ...(raw.web_search_requests !== undefined
      ? { webSearchRequests: raw.web_search_requests }
      : {}),
    ...(raw.web_fetch_requests !== undefined ? { webFetchRequests: raw.web_fetch_requests } : {}),
  };
}
