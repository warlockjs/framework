import { command } from "../cli-command";
import { doctorCommandAction } from "./doctor/doctor-command.action";

/**
 * `warlock doctor` — run a set of READ-ONLY diagnostic checks (routes, config,
 * connectors, optional peers, health endpoints, release hygiene) and print a
 * grouped pass/warn/fail report. Exits non-zero if any check fails.
 *
 * Preload plan: load every config file and bootstrap app code so routes and
 * connectors are registered for introspection, but DELIBERATELY start no
 * connectors — doctor must not open database/cache/socket connections. The
 * connectors check therefore reports the registered set and which (if any) are
 * already active without forcing them up.
 */
export const doctorCommand = command({
  name: "doctor",
  description:
    "Run read-only health checks (routes, config, connectors, optional peers, health endpoints, release hygiene) and print a pass/warn/fail report",
  action: doctorCommandAction,
  preload: {
    config: true,
    env: true,
    bootstrap: true,
  },
});
