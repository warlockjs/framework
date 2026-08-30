import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiBedrockFeature: FeatureDefinition = {
  description: "AWS Bedrock provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-bedrock": INSTALLED_WARLOCK_VERSION,
  },
};
