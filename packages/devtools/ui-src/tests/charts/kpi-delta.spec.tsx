import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiDelta, deltaText } from "@/components/charts";

describe("KpiDelta", () => {
  it("writes arrow, percent and the comparison", () => {
    expect(deltaText(112, 100, "previous 7 days")).toBe("▲ 12% vs previous 7 days");
    expect(deltaText(50, 100, "previous 7 days")).toBe("▼ 50% vs previous 7 days");
  });

  it("says No change and New", () => {
    expect(deltaText(5, 5, "previous 7 days")).toBe("No change");
    expect(deltaText(0, 0, "previous 7 days")).toBe("No change");
    expect(deltaText(3, 0, "previous 7 days")).toBe("New");
  });

  it("says No earlier data when the previous period was removed", () => {
    render(<KpiDelta current={2} previous={0} against="x" previousComplete={false} risingIsBad />);

    expect(screen.getByText("No earlier data")).not.toHaveClass("text-warning");
  });

  it("uses the warning tone only for a rising figure that is bad", () => {
    const { rerender } = render(<KpiDelta current={2} previous={1} against="x" risingIsBad />);

    expect(screen.getByText(/▲ 100%/)).toHaveClass("text-warning");

    rerender(<KpiDelta current={1} previous={2} against="x" risingIsBad />);
    expect(screen.getByText(/▼ 50%/)).not.toHaveClass("text-warning");

    rerender(<KpiDelta current={2} previous={1} against="x" />);
    expect(screen.getByText(/▲ 100%/)).not.toHaveClass("text-warning");
  });
});
