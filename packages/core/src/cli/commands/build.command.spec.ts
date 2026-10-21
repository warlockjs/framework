import { expect, it, vi } from "vitest";
import type { CommandActionData } from "../../commands/types";

const state = vi.hoisted(() => ({
  fail: false,
  report: { version: 1, pages: [], violations: [] },
}));
vi.mock("../../production/production-builder", () => ({
  ProductionBuilder: class {
    budgetReport = state.report;
    async build() {
      console.log("progress");
      if (state.fail) throw new Error("budget exceeded");
    }
  },
}));
import { buildCommandAction } from "./build.command";

it("prints one JSON document on success and on budget failure", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const data: CommandActionData = { args: [], options: { json: true } };
  try {
    state.fail = false;
    await buildCommandAction(data);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      success: true,
      budgets: state.report,
    });
    expect(stderr).toHaveBeenCalledWith("progress");
    output.mockClear();
    state.fail = true;
    await expect(buildCommandAction(data)).rejects.toThrow("budget exceeded");
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      success: false,
      budgets: state.report,
      error: "budget exceeded",
    });
  } finally {
    state.fail = false;
    output.mockRestore();
    stderr.mockRestore();
  }
});
