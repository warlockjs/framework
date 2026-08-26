import { FeatureDefinition } from "./types";

export const aiOpenaiFeature: FeatureDefinition = {
  description: "OpenAI provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-openai": "~4.0.0",
  },
};
