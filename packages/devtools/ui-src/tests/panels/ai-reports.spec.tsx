import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AiReportsPanel } from "@/panels/ai-reports";
import { formatRatio } from "@/panels/ai-shared/format-ai";
import { RANGE_STORAGE_KEY } from "@/panels/ai-shared/route";
import { reportView, totals, unavailable } from "./ai-fixtures";
import { failure, mockApi, renderPanel } from "./helpers";

const ready = () => screen.findByRole("group", { name: /^Tokens:/ });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("AI Reports", () => {
  it("shows the tiles with deltas, the charts and the tables", async () => {
    mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    renderPanel(AiReportsPanel, { route: "range=7d" });

    await ready();
    expect(screen.getAllByText("$12.50").length).toBeGreaterThan(0);
    expect(screen.getByText(/Estimated from model pricing · 10 unpriced runs/)).toBeInTheDocument();
    expect(screen.getAllByText("▲ 25% vs previous 7 days")).toHaveLength(2);
    expect(screen.getAllByText("150k").length).toBeGreaterThan(0);
    expect(screen.getByText("120k in · 30k out · 40k cached")).toBeInTheDocument();
    expect(screen.getAllByText("7.5 s").length).toBeGreaterThan(0);
    // Error rate rose from 5% to 10%: arrow, percent and the warning tone.
    expect(screen.getByText("▲ 100% vs previous 7 days")).toHaveClass("text-warning");
    expect(screen.getByRole("group", { name: /^Estimated cost by model:/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Tokens:/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Error rate:/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Top agents" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Top models" })).toBeInTheDocument();
  });

  it("shows a table view of a chart", async () => {
    mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    renderPanel(AiReportsPanel, { route: "range=7d" });

    await ready();

    const section = screen.getByRole("region", { name: "Tokens" });

    await userEvent.click(within(section).getByRole("button", { name: "Table" }));

    expect(within(section).getByRole("table", { name: "Tokens as a table" })).toBeInTheDocument();
    expect(
      within(within(section).getByRole("table")).getByText("Uncached input"),
    ).toBeInTheDocument();
  });

  it("warns about unpriced models and an observation that is off", async () => {
    mockApi([
      [
        /^api\/ai\/reports\?/,
        reportView({ unpricedModels: ["local/tiny", "x/y"], observationOff: true }),
      ],
    ]);
    renderPanel(AiReportsPanel);

    expect(
      await screen.findByText(/2 models have no pricing; their runs are not in the cost/),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI observation is off/)).toBeInTheDocument();
  });

  it("shows the empty state of a range without runs", async () => {
    mockApi([
      [
        /^api\/ai\/reports\?/,
        reportView({
          totals: totals({ runs: 0, errorRate: 0 }),
          previous: totals({ runs: 0, errorRate: 0 }),
          costByModel: { buckets: [], series: [] },
          tokens: { buckets: [], series: [] },
          errorRate: [],
          topAgents: [],
          topModels: [],
        }),
      ],
    ]);
    renderPanel(AiReportsPanel);

    expect(await screen.findByText("No priced runs in this range.")).toBeInTheDocument();
    expect(screen.getByText("No tokens used in this range.")).toBeInTheDocument();
    expect(screen.getByText(/so there is no error rate/)).toBeInTheDocument();
    expect(screen.getAllByText("Nothing in this range.")).toHaveLength(2);
  });

  it.each([
    [
      "table-missing",
      "AI reports need their table",
      "Run the devtools migrations.",
      "warlock migrate",
    ],
    ["reports-off", "AI reports are off", "Set devtools.ai.reports to true.", null],
    ["panoptic-missing", "Panoptic isn't installed", "Add Panoptic.", "warlock add ai-panoptic"],
    ["not-collected", "Production keeps hourly totals", "Open Reports.", null],
  ])("explains the %s state", async (reason, title, message, command) => {
    mockApi([[/^api\/ai\/reports\?/, unavailable(reason, title, message, command)]]);
    renderPanel(AiReportsPanel);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();

    if (command) expect(screen.getByText(command)).toBeInTheDocument();
    else expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("shows an API error with its message and reference", async () => {
    mockApi([
      [
        /^api\/ai\/reports\?/,
        failure(400, "The date range is not valid. Pick a start before the end.", { ref: "r-1" }),
      ],
    ]);
    renderPanel(AiReportsPanel);

    expect(await screen.findByText("Could not load the AI report")).toBeInTheDocument();
    expect(screen.getByText(/The date range is not valid/)).toBeInTheDocument();
    expect(screen.getByText("Reference: r-1")).toBeInTheDocument();
  });

  it("refetches with the right query when the range changes, and remembers it", async () => {
    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    const { navigations } = renderPanel(AiReportsPanel);

    await ready();
    expect(calls[0]?.url).toMatch(/^api\/ai\/reports\?range=24h&tz=-?\d+$/);

    await userEvent.click(screen.getByRole("button", { name: "30 d" }));

    expect(navigations.at(-1)).toBe("range=30d");
    expect(localStorage.getItem(RANGE_STORAGE_KEY)).toBe("30d");
    await ready();
    expect(calls.some((call) => /range=30d/.test(call.url))).toBe(true);
  });

  it("sends a custom range as from and to", async () => {
    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);

    renderPanel(AiReportsPanel);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("Range start"), "2026-11-10T08:00");
    await userEvent.type(screen.getByLabelText("Range end"), "2026-11-12T08:00");
    await userEvent.click(screen.getByRole("button", { name: "Apply range" }));

    const url = calls.at(-1)?.url ?? "";

    expect(url).toContain("range=custom");
    expect(url).toContain(`from=${new Date("2026-11-10T08:00").getTime()}`);
    expect(url).toContain(`to=${new Date("2026-11-12T08:00").getTime()}`);
  });

  it("rejects an end before the start without calling the server", async () => {
    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);

    renderPanel(AiReportsPanel);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("Range start"), "2026-11-12T08:00");
    await userEvent.type(screen.getByLabelText("Range end"), "2026-11-10T08:00");
    await userEvent.click(screen.getByRole("button", { name: "Apply range" }));

    expect(screen.getByText(/The end must be after the start/)).toBeInTheDocument();
    expect(calls.some((call) => /range=custom/.test(call.url))).toBe(false);
  });

  it("rejects an end in the future without calling the server", async () => {
    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    const later = new Date(Date.now() + 3 * 3_600_000);
    const local = new Date(later.getTime() - later.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

    renderPanel(AiReportsPanel);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Range end")).toHaveAttribute("max");
    await userEvent.type(screen.getByLabelText("Range start"), "2026-11-10T08:00");
    await userEvent.type(screen.getByLabelText("Range end"), local);
    await userEvent.click(screen.getByRole("button", { name: "Apply range" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The end is in the future");
    expect(calls.some((call) => /range=custom/.test(call.url))).toBe(false);
  });

  it("says No earlier data when the previous period is past the kept history", async () => {
    mockApi([[/^api\/ai\/reports\?/, reportView({ previousComplete: false })]]);
    renderPanel(AiReportsPanel, { route: "range=30d" });

    await ready();
    expect(screen.getAllByText("No earlier data")).toHaveLength(5);
    expect(screen.queryByText(/vs previous/)).toBeNull();
  });

  it("applies the agent filter and reads filters from the hash", async () => {
    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    const { navigations } = renderPanel(AiReportsPanel, { route: "range=7d&agent=checkout" });

    await ready();
    expect(calls[0]?.url).toContain("agent=checkout");
    expect(screen.getByLabelText("Agent")).toHaveValue("checkout");

    await userEvent.selectOptions(screen.getByLabelText("Model"), "anthropic/claude");
    expect(navigations.at(-1)).toBe("range=7d&agent=checkout&model=anthropic%2Fclaude");
  });

  it("uses the remembered range when the hash has none", async () => {
    localStorage.setItem(RANGE_STORAGE_KEY, "7d");

    const { calls } = mockApi([[/^api\/ai\/reports\?/, reportView()]]);

    renderPanel(AiReportsPanel);
    await ready();

    expect(calls[0]?.url).toContain("range=7d");
  });

  it("opens Models with the model filter from a model row", async () => {
    mockApi([[/^api\/ai\/reports\?/, reportView()]]);
    renderPanel(AiReportsPanel, { route: "range=7d" });
    await ready();

    await userEvent.click(screen.getByRole("row", { name: "Open openai/gpt-4o" }));

    expect(location.hash).toBe("#ai-models/range=7d&model=openai%2Fgpt-4o");
  });

  it("keeps the previous data while a new range loads", async () => {
    let release: () => void = () => undefined;
    let count = 0;

    mockApi([
      [
        /^api\/ai\/reports\?/,
        () => {
          count += 1;

          return count === 1
            ? reportView()
            : new Promise<never>((resolve) => (release = () => resolve(undefined as never)));
        },
      ],
    ]);
    renderPanel(AiReportsPanel);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "7 d" }));

    expect(screen.getAllByText("$12.50").length).toBeGreaterThan(0);
    release();
  });
});

describe("formatRatio", () => {
  it("never shows a non-zero ratio as 0%", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(0.0004)).toBe("<0.1%");
    expect(formatRatio(0.0005)).toBe("0.1%");
    expect(formatRatio(0.042)).toBe("4.2%");
    expect(formatRatio(0.37)).toBe("37%");
  });
});
