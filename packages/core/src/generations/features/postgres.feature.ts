import { FeatureDefinition } from "./types";

export const postgresFeature: FeatureDefinition = {
  description: "Installs pg for Postgres database (Cascade Package)",
  dependencies: {
    pg: "^8.11.0",
  },
};
