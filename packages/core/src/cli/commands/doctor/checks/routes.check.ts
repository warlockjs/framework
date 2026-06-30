import { router } from "../../../../router/router";
import type { DoctorCheck } from "../check.types";

/**
 * Reports the number of registered routes. A booted app with zero routes
 * almost always means a route module failed to register silently, so this
 * warns (rather than passing) when the route table is empty.
 *
 * Read-only: introspects the router via `routeCount()` only.
 */
export const routesCheck: DoctorCheck = {
  name: "routes",
  run: () => {
    const count = router.routeCount();

    if (count === 0) {
      return {
        name: "routes",
        status: "warn",
        detail: "0 routes registered — did a route module fail to load?",
      };
    }

    return {
      name: "routes",
      status: "ok",
      detail: `${count} registered`,
    };
  },
};
