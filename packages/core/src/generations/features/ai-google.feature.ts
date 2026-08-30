import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiGoogleFeature: FeatureDefinition = {
  description: "Google (Gemini) provider for @warlock.js/ai (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-google": INSTALLED_WARLOCK_VERSION,
  },
};
