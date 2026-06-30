import { getAIConfig, onConfigApplied } from "@warlock.js/ai";
import { applyPanopticConfig } from "./config/apply-panoptic-config";

// Side-effect wiring. Importing `@warlock.js/ai-panoptic` (even bare,
// `import "@warlock.js/ai-panoptic"`) subscribes panoptic to the core
// config seam so a later `ai.config({ panoptic })` wires the collector +
// dashboard onto the observe registry — without app code calling
// `applyPanopticConfig` by hand.
//
// 1. React to every future `ai.config(...)` merge.
onConfigApplied((config) => {
  applyPanopticConfig(config.panoptic);
});

// 2. Catch config that was applied BEFORE this import ran (e.g. the app
//    called `ai.config({ panoptic })` and only then imported panoptic).
applyPanopticConfig(getAIConfig().panoptic);
