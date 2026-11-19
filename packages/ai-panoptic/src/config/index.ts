// Config — declarative `ai.config({ panoptic })` support. The type
// augments core's `AIConfig`; `applyPanopticConfig` is the seam that
// reads the slot and wires the collector onto the core observe registry.

export { applyPanopticConfig, resetAppliedPanopticConfig } from "./apply-panoptic-config";
export { devtoolsPathHint, isInsideWarlockApp } from "./warlock-app";
export type { WarlockAppProbe } from "./warlock-app";

export type { PanopticConfig } from "./panoptic-config.type";
