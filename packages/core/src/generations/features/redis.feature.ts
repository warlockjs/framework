import { FeatureDefinition } from "./types";

export const redisFeature: FeatureDefinition = {
  description: "Installs redis for Redis cache driver (Cache Package)",
  dependencies: {
    redis: "^4.6.13",
  },
};
