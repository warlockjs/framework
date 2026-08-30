import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiAnthropicFeature: FeatureDefinition = {
  description: "Anthropic (Claude) provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-anthropic": INSTALLED_WARLOCK_VERSION,
  },
};
