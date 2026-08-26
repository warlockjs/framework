import { FeatureDefinition } from "./types";

export const mysqlFeature: FeatureDefinition = {
  description: "Installs mysql2 for MySQL database driver (Cascade Package)",
  dependencies: {
    mysql2: "^3.5.0",
  },
};
