import { warlockConfigManager } from "../../warlock-config/warlock-config.manager";
import { mcpToolsFromConfig, type WarlockMcpToolSource } from "./mcp-tool-registry";

/**
 * The extra MCP tools of the loaded `warlock.config.ts` (see
 * {@link mcpToolsFromConfig}); none when no config was loaded.
 */
export async function configuredMcpTools(): Promise<WarlockMcpToolSource[]> {
  if (!warlockConfigManager.isLoaded) return [];

  return mcpToolsFromConfig(await warlockConfigManager.load());
}
