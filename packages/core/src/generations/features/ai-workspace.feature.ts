import { linkAiPackageImport } from "./shared/link-ai-package-import";
import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiWorkspaceFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/ai-workspace — a policy-jailed filesystem + shell workspace for coding agents, as ai.workspace (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-workspace": INSTALLED_WARLOCK_VERSION,
  },
  onExecuting: () => linkAiPackageImport("@warlock.js/ai-workspace"),
};
