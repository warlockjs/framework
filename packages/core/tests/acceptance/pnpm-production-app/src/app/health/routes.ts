import { router } from "@warlock.js/core";

// The endpoint the acceptance run requests. Serving it is the only evidence
// that accepts: the bundle resolved every import, booted, and bound a port.
router.get("/acceptance", () => {
  return { status: "ok" };
});
