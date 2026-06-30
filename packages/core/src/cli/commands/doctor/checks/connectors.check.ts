import { connectorsManager } from "../../../../connectors/connectors-manager";
import type { DoctorCheck } from "../check.types";

/**
 * Reports which connectors are registered and which are currently active. This
 * is informational: a registered-but-inactive connector is normal (it simply
 * has no config wired), so the check passes as long as the manager can be
 * enumerated and reports its active set.
 *
 * Read-only: calls `connectorsManager.list()` and each connector's
 * `isActive()` (a pure getter) only.
 */
export const connectorsCheck: DoctorCheck = {
  name: "connectors",
  run: () => {
    const connectors = connectorsManager.list();
    const active = connectors.filter((connector) => connector.isActive());
    const activeNames = active.map((connector) => connector.name);

    const detail =
      activeNames.length > 0
        ? `${connectors.length} registered, active: ${activeNames.join(", ")}`
        : `${connectors.length} registered, none active`;

    return {
      name: "connectors",
      status: "ok",
      detail,
    };
  },
};
