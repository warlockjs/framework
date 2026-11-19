import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TimeLineChart } from "@/components/charts";
import { reportView } from "../panels/ai-fixtures";

const view = reportView();
const points = view.available ? view.errorRate : [];
const props = {
  title: "Error rate",
  seriesName: "Error rate",
  stepMs: 6 * 3_600_000,
  format: (value: number) => `${Math.round(value * 100)}%`,
  color: "var(--series-4)",
  emptyText: "No runs.",
};

describe("TimeLineChart", () => {
  it("breaks the line at buckets without a value", () => {
    const { container } = render(<TimeLineChart {...props} points={points} />);

    // Bucket 0 stands alone (a dot); buckets 2 and 3 form one segment.
    expect(container.querySelectorAll('[data-testid="line-dot"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="line-segment"]')).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("puts the crosshair on the hovered bucket and shows its figures", async () => {
    render(<TimeLineChart {...props} points={points} />);

    expect(screen.queryByTestId("crosshair")).toBeNull();

    fireEvent.mouseEnter(screen.getAllByTestId("chart-hit")[2] as Element);

    const tip = await screen.findByRole("tooltip");

    expect(within(tip).getByText("20%")).toBeInTheDocument();
    expect(screen.getByTestId("crosshair")).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getAllByTestId("chart-hit")[1] as Element);
    expect(within(screen.getByRole("tooltip")).getByText("No runs")).toBeInTheDocument();
  });

  it("supports the keyboard and a table view", async () => {
    render(<TimeLineChart {...props} points={points} />);

    screen.getByRole("group", { name: /Error rate: latest 30%/ }).focus();
    expect(within(await screen.findByRole("tooltip")).getByText("30%")).toBeInTheDocument();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(screen.getByRole("tooltip")).getByText("No runs")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Error rate as a table" })).toBeInTheDocument();
  });

  it("says so when no bucket had runs", () => {
    render(
      <TimeLineChart
        {...props}
        points={points.map((point) => ({ ...point, rate: null, runs: 0 }))}
      />,
    );

    expect(screen.getByText("No runs.")).toBeInTheDocument();
  });
});
