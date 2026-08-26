import { FeatureDefinition } from "./types";

export const aiBedrockFeature: FeatureDefinition = {
  description: "AWS Bedrock provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-bedrock": "~4.0.0",
  },
};
