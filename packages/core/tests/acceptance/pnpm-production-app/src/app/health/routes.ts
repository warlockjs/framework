import { environment, router } from "@warlock.js/core";

// The endpoint the acceptance run requests. Serving it is the only evidence
// that accepts: the bundle resolved every import, booted, and bound a port.
//
// It reports the environment the app ACTUALLY booted under, because the gate
// exists to exercise the production path and previously only did so by
// inheriting NODE_ENV from whoever ran it. Reading the value back out of the
// running app is the only assertion that cannot be satisfied by the runner
// setting a variable and never checking it took effect.
router.get("/acceptance", () => {
  return { status: "ok", environment: environment() };
});
