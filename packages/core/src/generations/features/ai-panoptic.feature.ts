import { linkAiPackageImport } from "./shared/link-ai-package-import";
import { FeatureDefinition } from "./types";

export const aiPanopticFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/ai-panoptic — observability for @warlock.js/ai (collector, exporters, zero-setup local dashboard) via ai.config({ panoptic }) (pulls the core ai package)",
  requires: ["ai"],
  dependencies: {
    "@warlock.js/ai-panoptic": "~4.0.0",
  },
  onExecuting: () => linkAiPackageImport("@warlock.js/ai-panoptic"),
};
