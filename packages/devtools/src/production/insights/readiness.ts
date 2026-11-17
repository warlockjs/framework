/**
 * Reads core's readiness (`health.readiness()`): the overall status and the
 * per-check map. Injected so specs need no booted app.
 */
export type DevtoolsHealthStatusReader = () => Promise<{
  status: "ok" | "error";
  checks?: Record<string, boolean>;
}>;
