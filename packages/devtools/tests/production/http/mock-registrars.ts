import { vi } from "vitest";

// The route files other packages own are replaced by small stand-ins, so these
// specs test the gate, the access table and the routes of this package only.
vi.mock(
  "../../../src/server/requests-routes",
  async () => (await import("./stubs")).requestsRoutes,
);
vi.mock(
  "../../../src/server/insights-routes",
  async () => (await import("./stubs")).insightsRoutes,
);
vi.mock("../../../src/server/log-routes", async () => (await import("./stubs")).logRoutes);
vi.mock("../../../src/server/explain-route", async () => (await import("./stubs")).explainRoute);
vi.mock("../../../src/server/ui-assets", async (original) =>
  (await import("./stubs")).uiAssets(
    await original<typeof import("../../../src/server/ui-assets")>(),
  ),
);
