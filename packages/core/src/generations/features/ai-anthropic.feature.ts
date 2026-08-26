import { FeatureDefinition } from "./types";

export const aiAnthropicFeature: FeatureDefinition = {
  description: "Anthropic (Claude) provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-anthropic": "~4.0.0",
  },
};
