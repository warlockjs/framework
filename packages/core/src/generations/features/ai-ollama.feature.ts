import { FeatureDefinition } from "./types";

export const aiOllamaFeature: FeatureDefinition = {
  description: "Ollama provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-ollama": "~4.0.0",
  },
};
