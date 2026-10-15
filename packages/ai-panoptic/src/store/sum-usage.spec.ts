import type { Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { emptyUsage, sumUsage } from "./sum-usage";

describe("sumUsage", () => {
  it("seeds an empty accumulator with required channels at zero", () => {
    const empty = emptyUsage();

    expect(empty).toEqual({ input: 0, output: 0, total: 0 });
    expect(empty.cachedTokens).toBeUndefined();
  });

  it("sums token channels", () => {
    const a: Usage = { input: 100, output: 50, total: 150 };
    const b: Usage = { input: 40, output: 10, total: 50 };

    const sum = sumUsage(a, b);

    expect(sum).toEqual({ input: 140, output: 60, total: 200 });
  });

  it("sums optional channels only when at least one side reports them", () => {
    const a: Usage = { input: 100, output: 50, total: 150, cachedTokens: 20 };
    const b: Usage = { input: 40, output: 10, total: 50, reasoningTokens: 8 };

    const sum = sumUsage(a, b);

    expect(sum.cachedTokens).toBe(20);
    expect(sum.reasoningTokens).toBe(8);
    expect(sum.cacheWriteTokens).toBeUndefined();
  });

  it("merges the cost breakdown per channel", () => {
    const a: Usage = {
      input: 100,
      output: 50,
      total: 150,
      cost: { input: 0.01, output: 0.03, cachedInput: 0.001 },
    };
    const b: Usage = {
      input: 40,
      output: 10,
      total: 50,
      cost: { input: 0.004, output: 0.006 },
    };

    const sum = sumUsage(a, b);

    expect(sum.cost?.input).toBeCloseTo(0.014);
    expect(sum.cost?.output).toBeCloseTo(0.036);
    expect(sum.cost?.cachedInput).toBeCloseTo(0.001);
  });

  it("preserves a priced contributor when merging with an unpriced one", () => {
    const priced: Usage = { input: 100, output: 50, total: 150, cost: { input: 0.01, output: 0.03 } };
    const unpriced: Usage = { input: 40, output: 10, total: 50 };

    const sum = sumUsage(priced, unpriced);

    expect(sum.cost?.input).toBeCloseTo(0.01);
    expect(sum.cost?.output).toBeCloseTo(0.03);
  });

  it("leaves cost undefined when neither side carries pricing", () => {
    const sum = sumUsage(emptyUsage(), { input: 40, output: 10, total: 50 });

    expect(sum.cost).toBeUndefined();
  });

  it("does not mutate either argument", () => {
    const a: Usage = { input: 100, output: 50, total: 150 };
    const b: Usage = { input: 40, output: 10, total: 50 };

    sumUsage(a, b);

    expect(a.input).toBe(100);
    expect(b.input).toBe(40);
  });
});
