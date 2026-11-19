import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { DevtoolsAiRunRow } from "@contracts";
import { AiPanel } from "@/panels/ai";
import { heatBackground, maxSpanCost, spanCostUsd } from "@/panels/ai/cost-heat";
import { failure, FakeEventSource, mockApi, renderPanel } from "./helpers";

const run: DevtoolsAiRunRow = {
  traceId: "run",
  requestId: "http-a",
  sessionId: null,
  name: "assistant",
  type: "agent",
  status: "incomplete",
  startedAt: "2026-10-19T10:00:00.000Z",
  incomplete: true,
  models: ["provider/<img onerror=alert(1)>"],
  duration: 100,
  usage: {
    input: 10,
    output: 5,
    total: 15,
    cachedTokens: 8,
    cacheWriteTokens: 2,
    inputIncludesCache: false,
  },
  cost: 0.12,
  promptKey: "greeter@2",
  toolCalls: 1,
  retries: 2,
};

const answer = (runs: DevtoolsAiRunRow[], extra: Record<string, unknown> = {}) => ({
  available: true,
  runs,
  groups: null,
  stats: {
    count: runs.length,
    failed: 1,
    estimatedCostUsd: 0.12,
    unpricedRuns: 0,
    p50Ms: 1000,
    p95Ms: 7500,
  },
  capacity: 200,
  ...extra,
});

const LIST = /^api\/ai\/runs(\?|$)/;

beforeEach(() => FakeEventSource.install());

describe("AI Runs panel", () => {
  it("renders the unavailable state as title, one line and a copyable command", async () => {
    mockApi([
      [
        LIST,
        {
          available: false,
          reason: "panoptic-missing",
          title: "Panoptic isn't installed",
          message: "Your app uses @warlock.js/ai. Add Panoptic to see its runs.",
          command: "warlock add ai-panoptic",
          detail: null,
        },
      ],
    ]);
    renderPanel(AiPanel);

    expect(await screen.findByText("Panoptic isn't installed")).toBeInTheDocument();
    expect(screen.getByText(/Add Panoptic to see its runs/)).toBeInTheDocument();
    expect(screen.getByText("warlock add ai-panoptic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("points production to Reports when run details are not collected", async () => {
    mockApi([
      [
        LIST,
        {
          available: false,
          reason: "not-collected",
          title: "Run details are not collected here",
          message:
            "Production keeps hourly AI totals, not run details. Open Reports, Models or Errors here.",
          command: null,
          detail: null,
        },
      ],
    ]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/Open Reports, Models or Errors here/)).toBeInTheDocument();
  });

  it("renders the load error and versions without a command", async () => {
    mockApi([
      [
        LIST,
        {
          available: false,
          reason: "panoptic-failed",
          title: "Panoptic could not be loaded",
          message: "Panoptic is installed but failed to load.",
          detail: "boom (@warlock.js/ai 5.58.0, @warlock.js/ai-panoptic 5.57.0)",
          command: null,
        },
      ],
    ]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/boom \(@warlock.js\/ai 5.58.0/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("renders an observed-but-empty state", async () => {
    mockApi([[LIST, answer([])]]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/Enable Panoptic observation/)).toBeInTheDocument();
  });

  it("shows tiles, usage, estimated cost and cache semantics without interpreting model text as HTML", async () => {
    mockApi([[LIST, answer([run])]]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/^10 input ·/)).toBeInTheDocument();
    expect(screen.getByText(/8 cache read/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.1200 estimated/)).toBeInTheDocument();
    expect(screen.getByText(/input excludes cache tokens/)).toBeInTheDocument();
    expect(screen.getByText(/2 retries · prompt greeter@2/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete \/ truncated/)).toBeInTheDocument();
    expect(screen.getByText("provider/<img onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();

    expect(screen.getByText("p50").nextSibling).toHaveTextContent("1 s");
    expect(screen.getByText("p95").nextSibling).toHaveTextContent("7.5 s");
    expect(screen.getByText("Failed", { selector: "dt" }).nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Estimated cost", { selector: "dt" }).nextSibling).toHaveTextContent(
      "$0.1200",
    );
  });

  it("shows a No pricing pill instead of a zero for an unpriced run", async () => {
    mockApi([[LIST, answer([{ ...run, cost: null, requestId: null }])]]);
    renderPanel(AiPanel);

    expect(await screen.findByText("No pricing")).toBeInTheDocument();
    expect(screen.getByText(/no pricing \(input excludes/)).toBeInTheDocument();
    expect(screen.getByText(/Background \/ no request id/)).toBeInTheDocument();
  });

  it("tints each span by its cost, with the number always shown, and keeps tool timing and metadata", async () => {
    const usage = { input: 10, output: 5, total: 15 };
    const root = {
      name: "assistant",
      type: "agent",
      status: "incomplete",
      startedAt: "2026-10-19T10:00:00.000Z",
      endedAt: "2026-10-19T10:00:00.100Z",
      duration: 100,
      usage: { ...usage, cost: { input: 0.01, output: 0.03 } },
      attributes: {
        "agent.compactions": [{ type: "applied", tripIndex: 1 }],
        "retry.attempts": [{ duration: 25, status: "failed" }],
      },
      children: [
        {
          name: "search",
          type: "tool",
          status: "completed",
          startedAt: "2026-10-19T10:00:00.010Z",
          endedAt: "2026-10-19T10:00:00.050Z",
          duration: 40,
          usage: { input: 0, output: 0, total: 0 },
          children: [],
        },
      ],
    };

    mockApi([
      [LIST, answer([run])],
      ["api/ai/runs/run", { startedAt: root.startedAt, root }],
    ]);
    renderPanel(AiPanel, { route: "run" });

    expect(await screen.findByText("tool search · completed · +10 ms · 40 ms")).toBeInTheDocument();
    expect(screen.getByText(/"retry\.attempts"/)).toBeInTheDocument();
    expect(screen.getByText(/"agent\.compactions"/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open HTTP request" })).toHaveAttribute(
      "href",
      "#requests/http-a",
    );

    const summary = screen.getByText(/^agent assistant · incomplete/).closest("summary");

    expect(summary).toHaveTextContent("$0.0400 estimated");
    expect(summary?.getAttribute("style")).toContain("color-mix");
    expect(
      screen
        .getByText(/^tool search/)
        .closest("summary")
        ?.getAttribute("style") ?? "",
    ).not.toContain("color-mix");
  });

  it("scales the tint from 5 to 25 percent", () => {
    const span = (cost: unknown, children: never[] = []) => ({
      name: "x",
      type: "agent",
      status: "completed",
      startedAt: "",
      endedAt: "",
      duration: 1,
      usage: { input: 0, output: 0, cost },
      children,
    });

    expect(spanCostUsd(span({ input: 1, output: 2 }))).toBe(3);
    expect(spanCostUsd(span(undefined))).toBeNull();
    // `usage` is rolled up: a parent at 5 with a child at 4 cost 1 itself.
    expect(spanCostUsd({ ...span(5), children: [span(4)] })).toBe(1);
    expect(spanCostUsd({ ...span(4), children: [span(4)] })).toBeNull();
    expect(maxSpanCost({ ...span(5), children: [span(4)] })).toBe(4);
    expect(heatBackground(4, 4)).toContain("25.0%");
    expect(heatBackground(0.0001, 4)).toContain("5.0%");
    expect(heatBackground(null, 4)).toBeUndefined();
  });

  it("filters through the server: search, status, type", async () => {
    const { calls } = mockApi([[LIST, answer([run])]]);
    const user = userEvent.setup();

    renderPanel(AiPanel);
    await screen.findByText(/^10 input ·/);
    await user.type(screen.getByLabelText("Search AI runs"), "checkout");
    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await user.click(screen.getByRole("button", { name: "Filter / refresh" }));

    expect(calls.some((call) => call.url === "api/ai/runs?q=checkout&status=failed")).toBe(true);

    await user.selectOptions(screen.getByLabelText("Status"), "Incomplete");

    expect(
      calls.some(
        (call) => call.url === "api/ai/runs?q=checkout&status=incomplete%2Cmax-iterations",
      ),
    ).toBe(true);
  });

  it("filters by an exact HTTP request id", async () => {
    const { calls } = mockApi([[LIST, answer([run])]]);
    const user = userEvent.setup();

    renderPanel(AiPanel);
    await screen.findByText(/^10 input ·/);
    await user.type(screen.getByLabelText("HTTP request id"), " http-a ");
    await user.click(screen.getByRole("button", { name: "Filter / refresh" }));

    expect(calls.some((call) => call.url === "api/ai/runs?requestId=http-a")).toBe(true);
  });

  it("shows unpriced runs next to the estimated cost", async () => {
    const view = answer([run]);

    mockApi([[LIST, { ...view, stats: { ...view.stats, unpricedRuns: 2 } }]]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/2 unpriced runs not in the cost/)).toBeInTheDocument();
  });

  it("groups runs and drills into a group", async () => {
    const group = {
      key: "s-1",
      label: "Session s-1",
      runs: 4,
      failed: 1,
      estimatedCostUsd: 0.5,
      p95Ms: 3000,
      traceIds: ["run"],
    };
    const { calls } = mockApi([
      [/groupBy=session/, answer([run], { groups: [group] })],
      [LIST, answer([run])],
    ]);
    const user = userEvent.setup();

    renderPanel(AiPanel);
    await screen.findByText(/^10 input ·/);
    await user.selectOptions(screen.getByLabelText("Group by"), "session");

    const table = await screen.findByRole("table", { name: "Run groups" });

    expect(within(table).getByText("Session s-1")).toBeInTheDocument();
    expect(within(table).getByText("$0.5000")).toBeInTheDocument();
    expect(calls.some((call) => call.url === "api/ai/runs?groupBy=session")).toBe(true);

    await user.click(within(table).getByRole("row", { name: "Show runs of Session s-1" }));

    expect(calls.some((call) => call.url === "api/ai/runs?session=s-1")).toBe(true);
  });

  it("selecting a run navigates to it", async () => {
    mockApi([[LIST, answer([run])]]);
    const user = userEvent.setup();
    const { navigations } = renderPanel(AiPanel);

    await user.click(await screen.findByText(/^assistant · incomplete/));

    expect(navigations).toEqual(["run"]);
  });

  it("shows API errors with message and ref", async () => {
    mockApi([[LIST, failure(500, "AI runs could not be read. Reload.", { ref: "ai-1" })]]);
    renderPanel(AiPanel);

    expect(await screen.findByText("AI runs could not be read. Reload.")).toBeInTheDocument();
    expect(screen.getByText("Reference: ai-1")).toBeInTheDocument();
  });

  it("shows a span-load failure beside the run summary", async () => {
    mockApi([
      [LIST, answer([run])],
      ["api/ai/runs/run", failure(404, "This run is no longer stored. Pick another run.")],
    ]);
    renderPanel(AiPanel, { route: "run" });

    const detail = await screen.findByRole("region", { name: "AI run detail" });

    expect(
      await within(detail).findByText("This run is no longer stored. Pick another run."),
    ).toBeInTheDocument();
  });
});
