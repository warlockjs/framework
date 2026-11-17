import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevtoolsSampleSummary } from "@contracts";
import { RequestsPanel } from "@/panels/requests";
import type { RequestDetail } from "@/panels/requests/types";
import { devSession, failure, FakeEventSource, instanceA, mockApi, prodAdmin, prodViewer, renderPanel } from "./helpers";

const row = (overrides: Partial<DevtoolsSampleSummary> = {}): DevtoolsSampleSummary => ({
  id: "req-1",
  method: "GET",
  path: "/posts",
  status: 200,
  startedAt: Date.now() - 5000,
  durationMs: 42,
  queryCount: 3,
  warningCount: 0,
  ...overrides,
});

const detail = (overrides: Partial<RequestDetail> = {}): RequestDetail =>
  ({
    id: "req-1",
    method: "GET",
    path: "/posts",
    status: 200,
    startedAt: 1000,
    durationMs: 100,
    queryCount: 1,
    warningCount: 1,
    phases: [{ name: "handler", startedAt: 1010, durationMs: 60 }],
    queries: [
      {
        id: "q1",
        connection: "main",
        driver: "postgres",
        sql: "select * from posts",
        shape: "select * from posts",
        shapeId: "shape1",
        startedAt: 1020,
        durationMs: 12,
        rowCount: 4,
      },
    ],
    cache: [],
    logs: [{ level: "warn", module: "app", action: "slow", message: "slow thing", at: 1030, context: { id: 7 } }],
    mails: ["mail-1"],
    warnings: [{ type: "n+1", message: "Ran 6 times", shape: "select * from posts", count: 6 }],
    droppedQueries: 0,
    ...overrides,
  }) as RequestDetail;

const aiOff = [/^api\/ai\?requestId=/, { available: false, message: "Install ai", runs: [] }] as const;

beforeEach(() => FakeEventSource.install());

describe("Requests panel", () => {
  it("renders rows with status, duration and query counts", async () => {
    mockApi([["api/requests", [row(), row({ id: "req-2", status: 500, persisted: true })]]]);
    renderPanel(RequestsPanel);

    expect((await screen.findAllByText("/posts", { selector: "div" })).length).toBe(2);
    expect(screen.getAllByText("3 queries")).toHaveLength(2);
    expect(screen.getByText("saved")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi([["api/requests", []]]);
    renderPanel(RequestsPanel);

    expect(await screen.findByText(/No requests yet/)).toBeInTheDocument();
  });

  it("shows the server's message and ref on an API error", async () => {
    mockApi([["api/requests", failure(500, "The request store failed. Try again.", { ref: "ref-123" })]]);
    renderPanel(RequestsPanel);

    expect(await screen.findByText("The request store failed. Try again.")).toBeInTheDocument();
    expect(screen.getByText("ref-123")).toBeInTheDocument();
  });

  it("filters by the fields and sends them to the server", async () => {
    const { calls } = mockApi([[/^api\/requests/, []]]);
    const user = userEvent.setup();

    renderPanel(RequestsPanel);
    await screen.findByText(/No requests yet/);
    await user.type(screen.getByLabelText("Status"), "5xx");
    await user.type(screen.getByLabelText("Method"), "POST");
    await user.type(screen.getByLabelText("Route"), "/posts");
    await user.selectOptions(screen.getByLabelText("Since"), "1h");
    await user.click(screen.getByRole("button", { name: "Filter" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url === "api/requests?status=5xx&method=POST&route=%2Fposts&since=1h")).toBe(true),
    );
    expect(await screen.findByText(/No request matches these filters/)).toBeInTheDocument();
  });

  it("opens a request: waterfall, queries with N+1, logs, mail and AI", async () => {
    mockApi([["api/requests", [row()]], ["api/requests/req-1", detail()], aiOff]);
    const user = userEvent.setup();
    const { navigations } = renderPanel(RequestsPanel);

    await user.click(await screen.findByText("/posts", { selector: "div" }));
    expect(navigations).toEqual(["req-1"]);

    const detailView = await screen.findByRole("region", { name: "Request detail" });

    expect(within(detailView).getByText("Ran 6 times")).toBeInTheDocument();
    expect(within(detailView).getByLabelText("Waterfall")).toBeInTheDocument();
    expect(within(detailView).getAllByText("select * from posts").length).toBeGreaterThan(0);
    expect(within(detailView).getByText("N+1")).toBeInTheDocument();
    expect(within(detailView).getByText("slow thing")).toBeInTheDocument();
    expect(within(detailView).getByRole("link", { name: "Mail mail-1" })).toHaveAttribute("href", "#mail/mail-1");
    expect(await within(detailView).findByText("Install ai")).toBeInTheDocument();
  });

  it("runs the per-query EXPLAIN in development and shows the plan tree", async () => {
    const { calls } = mockApi([
      ["api/requests/req-1", detail()],
      ["api/requests/req-1/queries/q1/explain", { plan: [{ "Node Type": "Seq Scan" }] }, "POST"],
      aiOff,
      ["api/requests", []],
    ]);
    const user = userEvent.setup();

    renderPanel(RequestsPanel, { route: "req-1" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect((await screen.findAllByText(/Seq Scan/)).length).toBeGreaterThan(0);
    expect(calls.some((call) => call.url === "api/requests/req-1/queries/q1/explain" && call.method === "POST")).toBe(true);
  });

  it("shows an EXPLAIN failure inside the query, with its message", async () => {
    mockApi([
      ["api/requests/req-1", detail()],
      ["api/requests/req-1/queries/q1/explain", failure(500, "EXPLAIN failed: connection closed. Try again.", { ref: "ex-1" }), "POST"],
      aiOff,
      ["api/requests", []],
    ]);
    const user = userEvent.setup();

    renderPanel(RequestsPanel, { route: "req-1" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect(await screen.findByText("EXPLAIN failed: connection closed. Try again.")).toBeInTheDocument();
    expect(screen.getByText("ex-1")).toBeInTheDocument();
  });

  it("uses the shape route for EXPLAIN in production, for an admin only", async () => {
    const productionDetail = detail({ cache: { hits: 2, misses: 1, writes: 0 } });
    const { calls } = mockApi([
      ["api/requests", []],
      ["api/instances", { current: instanceA.id, instances: [instanceA] }],
      ["api/requests/req-1", productionDetail],
      ["api/queries/shape1/explain", { shapeId: "shape1", driver: "postgres", executing: false, plan: { Plan: 1 }, instance: instanceA.id }, "POST"],
    ]);
    const user = userEvent.setup();

    renderPanel(RequestsPanel, { session: prodAdmin, route: "req-1" });
    await user.click(await screen.findByRole("button", { name: "Explain" }));

    expect(await screen.findByText(/Plan only: the query was not run/)).toBeInTheDocument();
    expect(calls.some((call) => call.url === "api/queries/shape1/explain")).toBe(true);
    expect(screen.getByText("2 hits · 1 misses · 0 writes")).toBeInTheDocument();
    expect(screen.queryByText("AI runs")).not.toBeInTheDocument();
  });

  it("hides EXPLAIN and Clear from a production viewer", async () => {
    mockApi([
      ["api/requests", [row()]],
      ["api/instances", { current: instanceA.id, instances: [instanceA] }],
      ["api/requests/req-1", detail({ cache: { hits: 0, misses: 0, writes: 0 } })],
    ]);

    renderPanel(RequestsPanel, { session: prodViewer, route: "req-1" });
    await screen.findByRole("region", { name: "Request detail" });

    expect(screen.queryByRole("button", { name: "Explain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("labels partial rows as not sampled and shows the instance in production", async () => {
    mockApi([
      ["api/requests", [row({ partial: true, instance: instanceA.id, status: 500 })]],
      ["api/instances", { current: instanceA.id, instances: [instanceA] }],
    ]);
    renderPanel(RequestsPanel, { session: prodViewer });

    expect(await screen.findByText("not sampled")).toBeInTheDocument();
    expect(await screen.findByText("web-1 #0")).toBeInTheDocument();
  });

  it("adds a live row from the stream", async () => {
    mockApi([["api/requests", [row()]]]);
    renderPanel(RequestsPanel);
    await screen.findByText("/posts", { selector: "div" });

    act(() => FakeEventSource.latest().emit("request", row({ id: "req-9", path: "/live-path" })));

    expect(await screen.findByText("/live-path")).toBeInTheDocument();
  });

  it("clears the requests as an admin after a confirmation", async () => {
    const { calls } = mockApi([
      ["api/requests", [row()]],
      ["api/requests", undefined, "DELETE"],
    ]);
    const user = userEvent.setup();

    renderPanel(RequestsPanel);
    await screen.findByText("/posts", { selector: "div" });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("shows persisted record sections and copies a curl command", async () => {
    mockApi([
      ["api/requests", []],
      aiOff,
      ["api/requests/req-1/curl", { curl: "curl -X GET 'http://x/posts'" }],
      [
        "api/requests/req-1",
        detail({
          record: {
            status: 500,
            headers: { accept: "json" },
            response: { size: 10 },
            error: { name: "TypeError", message: "boom", stack: "TypeError: boom\n at x" },
          },
        }),
      ],
    ]);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    renderPanel(RequestsPanel, { route: "req-1" });

    expect(await screen.findByText("TypeError: boom")).toBeInTheDocument();
    expect(screen.getByText(/at x/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy as curl" }));
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("curl -X GET 'http://x/posts'");
  });
});

void devSession;
