import { FeatureDefinition } from "./types";

export const aiGoogleFeature: FeatureDefinition = {
  description: "Google (Gemini) provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-google": "~4.0.0",
  },
};
