import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AiPanel } from "@/panels/ai";
import type { AiRun } from "@/panels/ai/types";
import { failure, FakeEventSource, mockApi, renderPanel } from "./helpers";

const run: AiRun = {
  traceId: "run",
  requestId: "http-a",
  name: "assistant",
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
  toolCalls: 1,
  retries: 2,
  cacheHits: 1,
  truncatedTrips: 1,
  compactions: 1,
  skippedCompactions: 1,
  providerCompactions: 0,
};

const answer = (runs: AiRun[]) => ({
  available: true,
  runs,
  aggregate: { traces: runs.length, usage: run.usage },
});

beforeEach(() => FakeEventSource.install());

describe("AI panel", () => {
  it("renders install guidance", async () => {
    mockApi([
      ["api/ai", { available: false, message: "Install @warlock.js/ai-panoptic", runs: [] }],
    ]);
    renderPanel(AiPanel);

    expect(await screen.findByText("Install @warlock.js/ai-panoptic")).toBeInTheDocument();
  });

  it("renders an observed-but-empty state", async () => {
    mockApi([["api/ai", { available: true, runs: [] }]]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/Enable Panoptic observation/)).toBeInTheDocument();
  });

  it("shows usage, cost, cache semantics, retries, truncation and compaction without interpreting model text as HTML", async () => {
    mockApi([["api/ai", answer([run])]]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/^10 input ·/)).toBeInTheDocument();
    expect(screen.getByText(/8 cache read/)).toBeInTheDocument();
    expect(screen.getByText(/cache write · \$0\.120000 USD/)).toBeInTheDocument();
    expect(screen.getByText(/input excludes cache tokens/)).toBeInTheDocument();
    expect(screen.getByText(/2 retries/)).toBeInTheDocument();
    expect(screen.getByText(/1 provider cache-hit trips/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete \/ truncated/)).toBeInTheDocument();
    expect(screen.getByText(/1 applied \/ 1 skipped compactions/)).toBeInTheDocument();
    expect(screen.getByText("provider/<img onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByLabelText(/Filter AI runs by HTTP request id/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /1 runs · 10 input tokens · 5 output tokens · \$0\.120000 USD \(reported cost\)/,
      ),
    ).toBeInTheDocument();
  });

  it("renders tool timing and retry/compaction metadata in the selected run tree", async () => {
    const root = {
      name: "assistant",
      type: "agent",
      status: "incomplete",
      startedAt: "2026-10-19T10:00:00.000Z",
      endedAt: "2026-10-19T10:00:00.100Z",
      duration: 100,
      usage: run.usage,
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
      ["api/ai", answer([run])],
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
  });

  it("shows background, unpriced and unreported values", async () => {
    mockApi([
      ["api/ai", answer([{ ...run, requestId: undefined, cost: undefined, cacheHits: undefined }])],
    ]);
    renderPanel(AiPanel);

    expect(await screen.findByText(/cache write · unpriced/)).toBeInTheDocument();
    expect(screen.getByText(/— provider cache-hit trips/)).toBeInTheDocument();
    expect(screen.getByText(/Background \/ no request id/)).toBeInTheDocument();
  });

  it("filters by HTTP request id through the server", async () => {
    const { calls } = mockApi([[/^api\/ai(\?|$)/, answer([run])]]);
    const user = userEvent.setup();

    renderPanel(AiPanel);
    await screen.findByText(/^10 input ·/);
    await user.type(screen.getByLabelText(/Filter AI runs by HTTP request id/), "http-a");
    await user.click(screen.getByRole("button", { name: "Filter / refresh" }));

    expect(calls.some((call) => call.url === "api/ai?requestId=http-a")).toBe(true);
  });

  it("selecting a run navigates to it", async () => {
    mockApi([["api/ai", answer([run])]]);
    const user = userEvent.setup();
    const { navigations } = renderPanel(AiPanel);

    await user.click(await screen.findByText(/^assistant · incomplete/));

    expect(navigations).toEqual(["run"]);
  });

  it("shows API errors with message and ref, inside the detail too", async () => {
    mockApi([["api/ai", failure(500, "AI runs could not be read. Reload.", { ref: "ai-1" })]]);
    renderPanel(AiPanel);

    expect(await screen.findByText("AI runs could not be read. Reload.")).toBeInTheDocument();
    expect(screen.getByText("Reference: ai-1")).toBeInTheDocument();
  });

  it("shows a span-load failure beside the run summary", async () => {
    mockApi([
      ["api/ai", answer([run])],
      ["api/ai/runs/run", failure(404, "This run is no longer stored. Pick another run.")],
    ]);
    renderPanel(AiPanel, { route: "run" });

    const detail = await screen.findByRole("region", { name: "AI run detail" });

    expect(
      await within(detail).findByText("This run is no longer stored. Pick another run."),
    ).toBeInTheDocument();
  });
});
