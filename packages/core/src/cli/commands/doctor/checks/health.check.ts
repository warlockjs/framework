import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";

/**
 * Confirms the built-in liveness (`/health`) and readiness (`/ready`)
 * endpoints will be exposed. The HTTP connector registers them automatically
 * unless `http.health.enabled` is explicitly `false`, so this check reads that
 * config flag and the (overridable) paths.
 *
 * Disabling the probes is a deliberate, supported choice but a common
 * misconfiguration in container/orchestrated deployments, so it is surfaced as
 * a `warn` rather than a pass.
 *
 * Read-only: inspects `config.get("http.health")` only.
 */
export const healthCheck: DoctorCheck = {
  name: "health",
  run: () => {
    const healthConfig = config.get("http.health");

    if (healthConfig?.enabled === false) {
      return {
        name: "health",
        status: "warn",
        detail: "health endpoints disabled (http.health.enabled = false)",
      };
    }

    const livenessPath = healthConfig?.path ?? "/health";
    const readinessPath = healthConfig?.readinessPath ?? "/ready";

    return {
      name: "health",
      status: "ok",
      detail: `liveness ${livenessPath} + readiness ${readinessPath} registered`,
    };
  },
};
