import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiErrorsPanel } from "@/panels/ai-errors";
import { errorsView, FROM, unavailable } from "./ai-fixtures";
import { failure, mockApi, renderPanel } from "./helpers";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const URL = /^api\/ai\/errors\?/;

describe("AI Errors", () => {
  it("shows tiles, the category chart, the groups and recent failed runs as links", async () => {
    mockApi([
      [
        URL,
        errorsView([
          {
            traceId: "t-1",
            agent: "checkout",
            model: "openai/gpt-4o",
            status: "error",
            category: "rate-limit",
            code: "PROVIDER_RATE_LIMIT",
            message: "Too many <b>requests</b>",
            endedAt: FROM,
            requestId: null,
          },
        ]),
      ],
    ]);
    renderPanel(AiErrorsPanel, { route: "range=7d" });

    expect(
      await screen.findByRole("group", { name: /^Failed runs by category:/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed runs").nextSibling).toHaveTextContent("10");
    expect(screen.getByText("Refusals").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Cancelled").nextSibling).toHaveTextContent("1");

    const groups = screen.getByRole("table", { name: "Failed runs by category" });

    expect(within(groups).getByText("Rate limit")).toBeInTheDocument();
    expect(within(groups).getByText("▲ 100% vs previous period")).toBeInTheDocument();
    expect(within(groups).getByText("New")).toBeInTheDocument();
    expect(within(groups).getByText("openai/gpt-4o (6)")).toBeInTheDocument();

    const recent = screen.getByRole("table", { name: "Recent failed runs" });

    expect(within(recent).getByRole("link", { name: "Open run" })).toHaveAttribute(
      "href",
      "#ai/t-1",
    );
    // Messages are text, never markup.
    expect(within(recent).getByText("Too many <b>requests</b>")).toBeInTheDocument();
    expect(recent.querySelector("b")).toBeNull();
  });

  it("lists two failed spans of one trace without a duplicate key, and colours categories apart from models", async () => {
    const failed = {
      traceId: "t-2",
      agent: "checkout",
      model: "openai/gpt-4o",
      status: "failed",
      category: "tool" as const,
      code: "TOOL_EXEC_FAILED",
      message: null,
      endedAt: FROM,
      requestId: null,
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      mockApi([[URL, errorsView([failed, { ...failed, agent: "search", category: "timeout" }])]]);
      renderPanel(AiErrorsPanel, { route: "range=7d" });

      const recent = await screen.findByRole("table", { name: "Recent failed runs" });

      expect(within(recent).getAllByRole("link", { name: "Open run" })).toHaveLength(2);
      expect(errors.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
      expect(sessionStorage.getItem("devtools.ai.series.errors")).not.toBeNull();
      expect(sessionStorage.getItem("devtools.ai.series")).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it("says No earlier data when the previous period is past the kept history", async () => {
    const view = errorsView();

    if (!view.available) throw new Error("fixture");

    mockApi([[URL, { ...view, previousComplete: false }]]);
    renderPanel(AiErrorsPanel, { route: "range=30d" });

    await screen.findByRole("group", { name: /^Failed runs by category:/ });
    expect(screen.queryByText(/vs previous/)).toBeNull();
    expect(screen.getAllByText("No earlier data").length).toBeGreaterThanOrEqual(2);
  });

  it("says run details are development only in production", async () => {
    const view = errorsView();

    if (!view.available) throw new Error("fixture");

    mockApi([[URL, { ...view, recent: null }]]);
    renderPanel(AiErrorsPanel);

    expect(
      await screen.findByText(/Production keeps hourly totals, not run details/),
    ).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    const view = errorsView();

    if (!view.available) throw new Error("fixture");

    mockApi([[URL, { ...view, groups: [], overTime: { buckets: [], series: [] }, recent: [] }]]);
    renderPanel(AiErrorsPanel);

    expect(
      await screen.findByText("No failed runs in this range.", { selector: "p.py-8" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No recent failed runs are kept in memory.")).toBeInTheDocument();
  });

  it.each([
    ["table-missing", "AI reports need their table"],
    ["reports-off", "AI reports are off"],
    ["panoptic-missing", "Panoptic isn't installed"],
    ["not-collected", "Not collected here"],
  ])("explains the %s state", async (reason, title) => {
    mockApi([[URL, unavailable(reason, title, "Do this next.")]]);
    renderPanel(AiErrorsPanel);

    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it("shows an API error with its reference", async () => {
    mockApi([
      [URL, failure(500, "The errors could not be read. Check the server log.", { ref: "e-3" })],
    ]);
    renderPanel(AiErrorsPanel);

    expect(await screen.findByText("Could not load the AI errors")).toBeInTheDocument();
    expect(screen.getByText("Reference: e-3")).toBeInTheDocument();
  });

  it("changes the range through the server", async () => {
    const { calls } = mockApi([[URL, errorsView()]]);

    renderPanel(AiErrorsPanel);
    await screen.findByRole("group", { name: /^Failed runs by category:/ });
    await userEvent.click(screen.getByRole("button", { name: "7 d" }));

    expect(calls.some((call) => /range=7d/.test(call.url))).toBe(true);
  });
});
