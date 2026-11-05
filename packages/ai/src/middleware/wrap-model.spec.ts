import { describe, expect, it } from "vitest";
import type { ModelContract } from "../contracts";
import { BudgetExceededError } from "../errors";
import { budget } from "./builtins/budget";

function model() {
  let calls = 0;
  const value: ModelContract = {
    name: "m",
    provider: "mock",
    complete: async () => {
      calls++;
      return { content: "ok", finishReason: "stop", usage: { input: 20, output: 20, total: 40 } };
    },
    async *stream() {
      yield { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
    },
  };
  return { value, count: () => calls };
}

describe("budget().wrapModel", () => {
  it("meters direct complete() calls with one running total", async () => {
    const { value, count } = model();
    const metered = budget({ maxTokens: 70 }).wrapModel(value);

    await metered.complete([{ role: "user", content: "a" }]);
    await expect(metered.complete([{ role: "user", content: "b" }])).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(count()).toBe(2);
    expect(metered.name).toBe("m");
  });

  it("refuses before the call when a reservation cannot fit", async () => {
    const { value, count } = model();
    const metered = budget({ maxTokens: 100, reserve: { outputTokens: 500 } }).wrapModel(value);

    await expect(metered.complete([{ role: "user", content: "a" }])).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(count()).toBe(0);
  });
});
