import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AiModelsPanel } from "@/panels/ai-models";
import { modelsView, unavailable } from "./ai-fixtures";
import { failure, mockApi, renderPanel } from "./helpers";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const URL = /^api\/ai\/models\?/;

describe("AI Models", () => {
  it("shows tiles, the runs chart and a row per model with its pricing state", async () => {
    mockApi([[URL, modelsView()]]);
    renderPanel(AiModelsPanel, { route: "range=7d" });

    expect(await screen.findByRole("group", { name: /^Runs by model:/ })).toBeInTheDocument();
    expect(screen.getByText("Models used").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Unpriced models").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Fallback rate").nextSibling).toHaveTextContent("5%");

    const table = screen.getByRole("table", { name: "Models" });

    expect(within(table).getByText("Pricing set")).toBeInTheDocument();
    expect(within(table).getByText("No pricing")).toBeInTheDocument();
    expect(within(table).getByText("Partly priced")).toBeInTheDocument();
    // A model without pricing never shows a $0 cost.
    expect(within(table).queryByText("$0")).toBeNull();
  });

  it("shows a model whose runs used no tokens as a neutral pill, not as unpriced", async () => {
    const view = modelsView();

    if (!view.available) throw new Error("fixture");

    const first = view.models[0]!;
    const noTokens = {
      ...first,
      key: "local/idle",
      model: "idle",
      provider: "local",
      pricing: "no-tokens" as const,
      costPerRunUsd: null,
    };

    mockApi([[URL, { ...view, models: [...view.models, noTokens] }]]);
    renderPanel(AiModelsPanel, { route: "range=7d" });

    const table = await screen.findByRole("table", { name: "Models" });
    const pill = within(table).getByText("No tokens used");

    expect(pill.closest("[class*='warning']")).toBeNull();
    expect(screen.getByText("Unpriced models").nextSibling).toHaveTextContent("2");
  });

  it("shows the empty state", async () => {
    const view = modelsView();

    if (!view.available) throw new Error("fixture");

    mockApi([[URL, { ...view, models: [], runsByModel: { buckets: [], series: [] } }]]);
    renderPanel(AiModelsPanel);

    expect(await screen.findByText("No models used in this range.")).toBeInTheDocument();
    expect(screen.getByText("No runs in this range.")).toBeInTheDocument();
  });

  it.each([
    ["table-missing", "AI reports need their table"],
    ["reports-off", "AI reports are off"],
    ["panoptic-missing", "Panoptic isn't installed"],
    ["not-collected", "Not collected here"],
  ])("explains the %s state", async (reason, title) => {
    mockApi([[URL, unavailable(reason, title, "Do this next.")]]);
    renderPanel(AiModelsPanel);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText("Do this next.")).toBeInTheDocument();
  });

  it("shows an API error with its reference", async () => {
    mockApi([
      [URL, failure(500, "The models could not be read. Check the server log.", { ref: "m-9" })],
    ]);
    renderPanel(AiModelsPanel);

    expect(await screen.findByText("Could not load the models")).toBeInTheDocument();
    expect(screen.getByText("Reference: m-9")).toBeInTheDocument();
  });

  it("refetches with the new range and the model filter", async () => {
    const { calls } = mockApi([[URL, modelsView()]]);
    const { navigations } = renderPanel(AiModelsPanel, { route: "range=7d&model=openai%2Fgpt-4o" });

    await screen.findByRole("group", { name: /^Runs by model:/ });
    expect(calls[0]?.url).toContain("model=openai%2Fgpt-4o");

    await userEvent.click(screen.getByRole("button", { name: "24 h" }));
    expect(navigations.at(-1)).toBe("range=24h&model=openai%2Fgpt-4o");
  });
});
