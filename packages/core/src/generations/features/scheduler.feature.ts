import { FeatureDefinition } from "./types";

export const schedulerFeature: FeatureDefinition = {
  description: "Installs warlock scheduler for scheduling tasks",
  dependencies: {
    "@warlock.js/scheduler": "~4.0.0",
  },
};
