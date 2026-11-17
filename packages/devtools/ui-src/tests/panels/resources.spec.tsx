import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DevtoolsResourcePoint, DevtoolsResourceSnapshot, DevtoolsResourcesView } from "@contracts";
import { ResourcesPanel } from "@/panels/resources";
import { failure, instanceA, instanceB, mockApi, prodViewer, renderPanel } from "./helpers";

const point = (at: number, rss: number): DevtoolsResourcePoint => ({
  at,
  rssBytes: rss,
  heapUsedBytes: rss / 2,
  heapTotalBytes: rss / 1.5,
  externalBytes: 1024,
  cpuPercent: 12.5,
  eventLoopDelayP50Ms: 1.2,
  eventLoopDelayP99Ms: 8.4,
  eventLoopDelayMaxMs: 20,
  eventLoopUtilization: 0.3,
  gcCount: 2,
  gcPauseMs: 3.5,
});

const snapshot = (): DevtoolsResourceSnapshot => ({
  ...point(3000, 300 * 1024 * 1024),
  heapLimitBytes: 2048 * 1024 * 1024,
  uptimeSeconds: 7200,
  gcByKind: {
    minor: { count: 40, pauseMs: 80 },
    major: { count: 2, pauseMs: 30 },
    incremental: { count: 0, pauseMs: 0 },
    weakcb: { count: 0, pauseMs: 0 },
  },
});

const view = (): DevtoolsResourcesView => ({
  instances: [
    { instance: instanceA, snapshot: snapshot(), history: [point(1000, 200 * 1024 * 1024), point(2000, 250 * 1024 * 1024)] },
    { instance: instanceB, snapshot: snapshot(), history: [] },
  ],
});

describe("Resources panel", () => {
  it("renders every instance with figures and charts", async () => {
    mockApi([[/^api\/resources/, view()]]);
    renderPanel(ResourcesPanel, { session: prodViewer });

    expect(await screen.findByText("web-1 #0")).toBeInTheDocument();
    expect(screen.getByText("web-2 #1")).toBeInTheDocument();
    expect(screen.getAllByText("300 MB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12.5 %").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8.4 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("RSS trend").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: /^Memory:/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/minor 40 runs/).length).toBeGreaterThan(0);
  });

  it("sends the chosen instance", async () => {
    const { calls } = mockApi([[/^api\/resources/, view()]]);

    renderPanel(ResourcesPanel, { session: prodViewer, instance: instanceB.id });
    await screen.findByText("web-1 #0");

    expect(calls[0]?.url).toBe(`api/resources?instance=${encodeURIComponent(instanceB.id)}`);
  });

  it("shows the empty state", async () => {
    mockApi([[/^api\/resources/, { instances: [] }]]);
    renderPanel(ResourcesPanel);

    expect(await screen.findByText(/No instance has reported its resources yet/)).toBeInTheDocument();
  });

  it("shows an API error with message and ref", async () => {
    mockApi([[/^api\/resources/, failure(500, "Resources are not available. Restart the app.", { ref: "res-1" })]]);
    renderPanel(ResourcesPanel);

    const alert = await screen.findByRole("alert");

    expect(within(alert).getByText("Resources are not available. Restart the app.")).toBeInTheDocument();
    expect(within(alert).getByText("res-1")).toBeInTheDocument();
  });
});
