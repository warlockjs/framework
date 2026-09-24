import type { FeatureDefinition } from "./types";

/**
 * MySQL is not implemented by Cascade (`connectToDatabase` throws for it), so
 * installing `mysql2` would only produce an app that crashes on boot. No
 * dependencies are declared and running the feature fails loudly instead.
 */
export const mysqlFeature: FeatureDefinition = {
  description: "MySQL (not supported by @warlock.js/cascade yet)",
  onExecuting: async () => {
    throw new Error(
      "MySQL is not supported by @warlock.js/cascade yet; use postgres or mongodb",
    );
  },
};
