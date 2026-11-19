import { getAIConfig } from "@warlock.js/ai";
import type { EvaluateConfig } from "./evaluate.type";

/**
 * The evaluate settings of the applied Panoptic config: `panoptic.evaluate`,
 * else `panoptic.dashboard.evaluate` when `dashboard` is an object, else
 * `undefined`. Devtools' Evaluate page reads it, so grading works while the
 * standalone dashboard stays off inside a Warlock app.
 */
export function getEvaluateConfig(): EvaluateConfig | undefined {
  const panopticConfig = getAIConfig().panoptic;

  if (panopticConfig === undefined) {
    return undefined;
  }

  if (panopticConfig.evaluate !== undefined) {
    return panopticConfig.evaluate;
  }

  const dashboardConfig = panopticConfig.dashboard;

  return typeof dashboardConfig === "object" ? dashboardConfig.evaluate : undefined;
}
