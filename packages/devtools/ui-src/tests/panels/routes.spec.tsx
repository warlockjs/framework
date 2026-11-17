import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { DevtoolsRouteStatsRow } from "@contracts";
import { RoutesPanel } from "@/panels/routes";
import { failure, instanceA, mockApi, prodViewer, renderPanel } from "./helpers";
import { histogram } from "./fixtures";

const stats = (overrides: Partial<DevtoolsRouteStatsRow> = {}): DevtoolsRouteStatsRow => ({
  key: "GET /posts/:slug",
  method: "GET",
  route: "/posts/:slug",
  count: 300,
  errors: 4,
  histogram: histogram([10, 100, 150, 40], 220),
  phases: [
    { name: "handler", count: 300, sumMs: 6000, maxMs: 90 },
    { name: "validation", count: 300, sumMs: 600, maxMs: 9 },
  ],
  slowest: null,
  p50Ms: 12,
  p95Ms: 80,
  meanMs: 20,
  instances: [instanceA.id],
  ...overrides,
});

const map = [
  { method: "GET", path: "/posts/:slug", name: "posts.show", middleware: ["auth"] },
  { method: "POST", path: "/login" },
];

describe("Routes panel", () => {
  it("renders statistics and the route map, and filters the map", async () => {
    mockApi([
      [/^api\/routes\/stats/, { routes: [stats()], sampleRate: 0.1, instanceCount: 1 }],
      ["api/routes", map],
    ]);
    const user = userEvent.setup();

    renderPanel(RoutesPanel, { session: prodViewer });

    const statsTable = await screen.findByRole("table", { name: "Route statistics table" });

    expect(within(statsTable).getByText("GET /posts/:slug")).toBeInTheDocument();
    expect(within(statsTable).getByText("80.0 ms")).toBeInTheDocument();

    const mapTable = await screen.findByRole("table", { name: "Route map table" });

    expect(within(mapTable).getByText("posts.show")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Filter routes"), "login");
    expect(
      within(screen.getByRole("table", { name: "Route map table" })).queryByText("posts.show"),
    ).not.toBeInTheDocument();
  });

  it("expands a route to its slowest phases", async () => {
    mockApi([
      [/^api\/routes\/stats/, { routes: [stats()], sampleRate: 1, instanceCount: 1 }],
      ["api/routes", []],
    ]);
    const user = userEvent.setup();

    renderPanel(RoutesPanel, { session: prodViewer });
    await user.click(await screen.findByRole("button", { name: "GET /posts/:slug" }));

    const phases = await screen.findByLabelText("Slowest phases");

    expect(within(phases).getByText("handler")).toBeInTheDocument();
    expect(within(phases).getByText("20.0 ms avg")).toBeInTheDocument();
  });

  it("shows empty states", async () => {
    mockApi([
      [/^api\/routes\/stats/, { routes: [], sampleRate: 1, instanceCount: 1 }],
      ["api/routes", []],
    ]);
    renderPanel(RoutesPanel);

    expect(await screen.findByText(/No route timings yet/)).toBeInTheDocument();
    expect(await screen.findByText("No routes found.")).toBeInTheDocument();
  });

  it("shows each section's error with message and ref", async () => {
    mockApi([
      [
        /^api\/routes\/stats/,
        failure(500, "Route statistics are unavailable. Reload.", { ref: "r-1" }),
      ],
      [
        "api/routes",
        failure(500, "The route map could not be read. Restart the app.", { ref: "r-2" }),
      ],
    ]);
    renderPanel(RoutesPanel);

    expect(
      await screen.findByText("Route statistics are unavailable. Reload."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: r-1")).toBeInTheDocument();
    expect(
      await screen.findByText("The route map could not be read. Restart the app."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: r-2")).toBeInTheDocument();
  });
});
