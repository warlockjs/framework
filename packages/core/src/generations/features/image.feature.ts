import { FeatureDefinition } from "./types";

export const imageFeature: FeatureDefinition = {
  description: "Installs sharp for image processing",
  dependencies: {
    sharp: "^0.34.5",
  },
};
