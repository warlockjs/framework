import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiOllamaFeature: FeatureDefinition = {
  description: "Ollama provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-ollama": INSTALLED_WARLOCK_VERSION,
  },
};
