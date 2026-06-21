// Main API
export { panoptic } from "./panoptic";

// Middleware adapter (for advanced use — `panoptic().middleware()` is the
// usual entry point)
export { createPanopticMiddleware } from "./panoptic-middleware";

// Types
export type { Panoptic, PanopticOptions } from "./panoptic.type";
export type { CompletedEventPayload, PanopticTarget } from "./panoptic-target.type";
