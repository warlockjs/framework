import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { DevtoolsQueryShapeRow, DevtoolsQueryStatsView } from "@contracts";
import { QueriesPanel } from "@/panels/queries";
import { devSession, failure, instanceA, mockApi, prodAdmin, prodViewer, renderPanel } from "./helpers";
import { histogram } from "./fixtures";

const shape = (overrides: Partial<DevtoolsQueryShapeRow> = {}): DevtoolsQueryShapeRow => ({
  id: "abc123",
  shape: "select * from users where id = ?",
  driver: "postgres",
  connection: "main",
  count: 120,
  errors: 2,
  histogram: histogram([5, 20, 50, 40, 5], 87),
  nPlusOne: { requests: 3, maxPerRequest: 9 },
  slowest: { durationMs: 87, at: Date.now() - 60_000, route: "GET /users/:id", requestId: "req-7", instance: instanceA.id },
  firstSeen: 1,
  lastSeen: 2,
  explainable: true,
  p50Ms: 4,
  p95Ms: 25,
  meanMs: 9,
  instances: [instanceA.id],
  ...overrides,
});

const view = (shapes: DevtoolsQueryShapeRow[], sampleRate = 0.1): DevtoolsQueryStatsView => ({
  shapes,
  sampleRate,
  instanceCount: 1,
  evicted: 0,
});

describe("Queries panel", () => {
  it("renders the statistics table and the sample-rate note", async () => {
    mockApi([[/^api\/queries\/stats/, view([shape()])], ["api/background", { queries: [] }]]);
    renderPanel(QueriesPanel, { session: prodViewer });

    const table = await screen.findByRole("table", { name: "Query statistics" });

    expect(within(table).getByText("select * from users where id = ?")).toBeInTheDocument();
    expect(within(table).getByText("120")).toBeInTheDocument();
    expect(within(table).getByText("25.0 ms")).toBeInTheDocument();
    expect(screen.getByText("Counts come from sampled requests (10 %).")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi([[/^api\/queries\/stats/, view([])]]);
    renderPanel(QueriesPanel, { session: prodViewer });

    expect(await screen.findByText(/No queries recorded yet/)).toBeInTheDocument();
  });

  it("shows an API error with message and ref", async () => {
    mockApi([[/^api\/queries\/stats/, failure(500, "Statistics are unavailable. Reload the page.", { ref: "q-1" })]]);
    renderPanel(QueriesPanel, { session: prodViewer });

    expect(await screen.findByText("Statistics are unavailable. Reload the page.")).toBeInTheDocument();
    expect(screen.getByText("q-1")).toBeInTheDocument();
  });

  it("sorts through the server and passes the instance", async () => {
    const { calls } = mockApi([[/^api\/queries\/stats/, view([shape()])]]);
    const user = userEvent.setup();

    renderPanel(QueriesPanel, { session: prodViewer, instance: instanceA.id });
    await screen.findByRole("table", { name: "Query statistics" });
    await user.selectOptions(screen.getByLabelText("Sort by"), "p95");

    expect(calls.some((call) => call.url === `api/queries/stats?sort=p95&instance=${encodeURIComponent(instanceA.id)}`)).toBe(true);
  });

  it("opens a shape: histogram, slowest example with a request link, N+1", async () => {
    mockApi([[/^api\/queries\/stats/, view([shape()])]]);
    const user = userEvent.setup();

    renderPanel(QueriesPanel, { session: prodViewer });
    await user.click(await screen.findByRole("button", { name: /select \* from users/ }));

    const detail = await screen.findByRole("region", { name: "Query detail" });

    expect(within(detail).getByLabelText("Latency histogram")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "open request" })).toHaveAttribute("href", "#requests/req-7");
    expect(within(detail).getByText(/up to 9 runs in one request/)).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Explain" })).not.toBeInTheDocument();
  });

  it("lets an admin run EXPLAIN on the shape and shows the plan tree", async () => {
    const { calls } = mockApi([
      [/^api\/queries\/stats/, view([shape()])],
      [
        "api/queries/abc123/explain",
        { shapeId: "abc123", driver: "postgres", executing: false, plan: [{ Plan: { "Node Type": "Index Scan" } }], instance: instanceA.id },
        "POST",
      ],
    ]);
    const user = userEvent.setup();

    renderPanel(QueriesPanel, { session: prodAdmin, route: "abc123" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect((await screen.findAllByText(/Index Scan/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Plan only: the query was not run/)).toBeInTheDocument();
    expect(calls.some((call) => call.url === "api/queries/abc123/explain" && call.method === "POST")).toBe(true);
  });

  it("labels an executing plan", async () => {
    mockApi([
      [/^api\/queries\/stats/, view([shape()])],
      ["api/queries/abc123/explain", { shapeId: "abc123", driver: "postgres", executing: true, plan: { a: 1 }, instance: instanceA.id }, "POST"],
    ]);
    const user = userEvent.setup();

    renderPanel(QueriesPanel, { session: prodAdmin, route: "abc123" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect(await screen.findByText(/Executing plan: the database ran this query/)).toBeInTheDocument();
  });

  it("shows the server's message when EXPLAIN runs on another instance", async () => {
    mockApi([
      [/^api\/queries\/stats/, view([shape()])],
      ["api/queries/abc123/explain", failure(409, "This example is held by web-2 #1. Open the dashboard on that instance and try again.", { code: "explain.elsewhere" }), "POST"],
    ]);
    const user = userEvent.setup();

    renderPanel(QueriesPanel, { session: prodAdmin, route: "abc123" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect(await screen.findByText(/held by web-2 #1/)).toBeInTheDocument();
  });

  it("says when a shape cannot be explained, and shows background queries only in development", async () => {
    mockApi([
      [/^api\/queries\/stats/, view([shape({ explainable: false })], 1)],
      ["api/background", { queries: [{ id: "b1", driver: "postgres", sql: "select 1 from jobs", durationMs: 3 }] }],
    ]);

    renderPanel(QueriesPanel, { session: devSession, route: "abc123" });

    expect(await screen.findByText(/EXPLAIN is not available for this query type/)).toBeInTheDocument();
    expect(await screen.findByText("select 1 from jobs")).toBeInTheDocument();
    expect(screen.getByText("Counts cover every request.")).toBeInTheDocument();
  });
});
