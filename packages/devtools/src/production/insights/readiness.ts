/**
 * Reads core's readiness (`health.readiness()`): the overall status and the
 * per-check map, or `null` while the app is still booting (core answers
 * `error` then, which says nothing about its health). Injected so specs need
 * no booted app.
 */
export type DevtoolsHealthStatusReader = () => Promise<{
  status: "ok" | "error";
  checks?: Record<string, boolean>;
} | null>;
