import { describe, expect, it } from "vitest";
import type { Usage } from "@warlock.js/ai";
import { totalCostUsd } from "./total-cost";

describe("totalCostUsd", () => {
  it("should return undefined when no cost breakdown is attached", () => {
    const usage: Usage = { input: 100, output: 200, total: 300 };

    expect(totalCostUsd(usage)).toBeUndefined();
  });

  it("should sum input and output cost", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      total: 300,
      cost: { input: 0.01, output: 0.04 },
    };

    expect(totalCostUsd(usage)).toBeCloseTo(0.05, 10);
  });

  it("should include cached input and cached output components", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      total: 300,
      cost: { input: 0.01, output: 0.04, cachedInput: 0.001, cachedOutput: 0.002 },
    };

    expect(totalCostUsd(usage)).toBeCloseTo(0.053, 10);
  });

  it("should treat missing cost fields as zero", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      total: 300,
      cost: { input: 0.01, output: 0.02 },
    };

    expect(totalCostUsd(usage)).toBeCloseTo(0.03, 10);
  });

  it("should fold in a separately-priced reasoning component", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      total: 300,
      cost: { input: 0.01, output: 0.04, reasoning: 0.006 },
    };

    expect(totalCostUsd(usage)).toBeCloseTo(0.056, 10);
  });
});
