import { FeatureDefinition } from "./types";

export const mongodbFeature: FeatureDefinition = {
  description: "Installs mongodb driver for database driver (Cascade Package)",
  dependencies: {
    mongodb: "^7.0.0",
  },
};
