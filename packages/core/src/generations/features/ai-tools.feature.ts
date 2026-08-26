import { linkAiPackageImport } from "./shared/link-ai-package-import";
import { FeatureDefinition } from "./types";

export const aiToolsFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/ai-tools — ready-made agent tools (web search, fetch, HTTP, calculator, date-time) + an MCP client/server, under ai.tools.* / ai.mcp (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-tools": "~4.0.0",
  },
  onExecuting: () => linkAiPackageImport("@warlock.js/ai-tools"),
};
