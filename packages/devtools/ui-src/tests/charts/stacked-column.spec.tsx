import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StackedColumnChart } from "@/components/charts";
import { buckets, seriesSet } from "../panels/ai-fixtures";

const STEP = 6 * 3_600_000;
const props = {
  title: "Cost by model",
  stepMs: STEP,
  format: (value: number) => `$${value}`,
  color: (key: string) => (key === "openai/gpt-4o" ? "var(--series-1)" : "var(--series-2)"),
  emptyText: "Nothing here.",
};

describe("StackedColumnChart", () => {
  it("has a summary label, a legend of every series and a table toggle", async () => {
    render(<StackedColumnChart {...props} set={seriesSet()} />);

    expect(
      screen.getByRole("group", { name: /Cost by model: \$11 in total over 4 periods/ }),
    ).toBeInTheDocument();

    const legend = screen.getByRole("list", { name: "Legend" });

    expect(within(legend).getAllByRole("listitem")).toHaveLength(3);
    expect(within(legend).getByText("Other")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Table" }));

    const table = screen.getByRole("table", { name: "Cost by model as a table" });

    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByText("Total")).toBeInTheDocument();
  });

  it("paints the Other series gray and draws one hit area per bucket", () => {
    const { container } = render(<StackedColumnChart {...props} set={seriesSet()} />);

    expect(container.querySelectorAll('[data-testid="chart-hit"]')).toHaveLength(buckets.length);
    expect(container.querySelector('[fill="var(--series-other)"]')).not.toBeNull();
  });

  it("shows one tooltip with every series and the total on hover", async () => {
    render(<StackedColumnChart {...props} set={seriesSet()} />);

    fireEvent.mouseEnter(screen.getAllByTestId("chart-hit")[1] as Element);

    const tip = await screen.findByRole("tooltip");

    expect(within(tip).getByText("$2")).toBeInTheDocument();
    expect(within(tip).getByText("openai/gpt-4o")).toBeInTheDocument();
    expect(within(tip).getByText("anthropic/claude")).toBeInTheDocument();
    expect(within(tip).getByText("Other")).toBeInTheDocument();
    expect(within(tip).getByText("Total").nextSibling).toHaveTextContent("$3");
  });

  it("moves the focused bucket with the arrow keys and lists every series", async () => {
    render(<StackedColumnChart {...props} set={seriesSet()} />);

    const plot = screen.getByRole("group", { name: /Cost by model/ });

    plot.focus();
    // Focus starts on the newest bucket (total 5).
    expect(
      within(await screen.findByRole("tooltip")).getByText("Total").nextSibling,
    ).toHaveTextContent("$5");

    await userEvent.keyboard("{ArrowLeft}");
    // The third bucket is all zero.
    expect(within(screen.getByRole("tooltip")).getByText("Total").nextSibling).toHaveTextContent(
      "$0",
    );

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    const tip = screen.getByRole("tooltip");

    expect(within(tip).getByText("Total").nextSibling).toHaveTextContent("$3");
    expect(within(tip).getAllByRole("listitem")).toHaveLength(3);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the empty text for all-zero data and no legend for one series", () => {
    const empty = {
      buckets,
      series: [{ key: "a", label: "A", values: [0, 0, 0, 0], other: false }],
    };
    const { rerender } = render(<StackedColumnChart {...props} set={empty} />);

    expect(screen.getByText("Nothing here.")).toBeInTheDocument();

    rerender(
      <StackedColumnChart
        {...props}
        set={{ buckets, series: [{ key: "a", label: "A", values: [1, 0, 0, 0], other: false }] }}
      />,
    );
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("dims while loading", () => {
    const { container } = render(<StackedColumnChart {...props} set={seriesSet()} loading />);

    expect(container.querySelector("section")).toHaveClass("opacity-60");
  });
});
