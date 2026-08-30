import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const schedulerFeature: FeatureDefinition = {
  description: "Installs warlock scheduler for scheduling tasks",
  dependencies: {
    "@warlock.js/scheduler": INSTALLED_WARLOCK_VERSION,
  },
};
