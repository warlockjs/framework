import { describe, expect, it } from "vitest";
import type { EvalCaseResult } from "../contracts/agent/eval.type";
import { computeStats, normalQuantile, tCritical, tInterval, wilsonInterval } from "./statistics";

/** Build a case result from per-run `[score, passed]` pairs. */
function caseOf(name: string, runs: Array<[number, boolean]>, category?: string): EvalCaseResult {
  const scores = runs.map(([score]) => score);

  return {
    case: { name, input: name, category },
    result: { text: "" } as unknown as EvalCaseResult["result"],
    scores: [],
    score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    passed: runs.every(([, passed]) => passed),
    duration: 0,
    runs: runs.map(([score, passed]) => ({ score, passed, duration: 0 })),
  };
}

describe("normalQuantile", () => {
  it("should match known quantiles", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829, 5);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
  });
});

describe("tCritical", () => {
  it("should match the t table at 95% confidence", () => {
    expect(tCritical(1)).toBeCloseTo(12.7062, 3);
    expect(tCritical(2)).toBeCloseTo(4.3027, 3);
    expect(tCritical(9)).toBeCloseTo(2.2622, 3);
    expect(tCritical(30)).toBeCloseTo(2.0423, 3);
  });

  it("should match the t table at 90% confidence", () => {
    expect(tCritical(9, 0.9)).toBeCloseTo(1.8331, 3);
  });
});

describe("wilsonInterval", () => {
  it("should compute the interval for 8 of 10", () => {
    const interval = wilsonInterval(8, 10);

    expect(interval.low).toBeCloseTo(0.4902, 3);
    expect(interval.high).toBeCloseTo(0.9433, 3);
  });

  it("should stay non-degenerate at zero and full successes", () => {
    const none = wilsonInterval(0, 10);
    const all = wilsonInterval(10, 10);

    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 3);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7225, 3);
  });

  it("should be wide for tiny samples and narrow for large ones", () => {
    const small = wilsonInterval(2, 2);
    const large = wilsonInterval(200, 200);

    expect(1 - small.low).toBeGreaterThan(0.5);
    expect(1 - large.low).toBeLessThan(0.03);
  });

  it("should return the uninformative interval for no samples", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("tInterval", () => {
  it("should compute a clamped interval for three scores", () => {
    const interval = tInterval([0.8, 0.9, 1]);

    expect(interval.low).toBeCloseTo(0.6516, 3);
    expect(interval.high).toBe(1);
  });

  it("should compute an unclamped interval", () => {
    const interval = tInterval([0.4, 0.5, 0.6, 0.5]);
    // mean 0.5, sd = sqrt(0.02/3), t(3) = 3.1824
    const margin = (3.1824463 * Math.sqrt(0.02 / 3)) / 2;

    expect(interval.low).toBeCloseTo(0.5 - margin, 3);
    expect(interval.high).toBeCloseTo(0.5 + margin, 3);
  });

  it("should collapse to a point when all scores are equal", () => {
    expect(tInterval([0.7, 0.7, 0.7])).toEqual({ low: 0.7, high: 0.7 });
  });

  it("should be uninformative under two samples", () => {
    expect(tInterval([0.9])).toEqual({ low: 0, high: 1 });
    expect(tInterval([])).toEqual({ low: 0, high: 1 });
  });
});

describe("computeStats", () => {
  it("should pool runs overall and per category", () => {
    const stats = computeStats([
      caseOf("a", [[1, true], [1, true], [0, false]], "math"),
      caseOf("b", [[1, true], [1, true], [1, true]], "math"),
      caseOf("c", [[0, false], [0, false], [0, false]], "geo"),
    ]);

    expect(stats.confidence).toBe(0.95);
    expect(stats.overall.runs).toBe(9);
    expect(stats.overall.passes).toBe(5);
    expect(stats.overall.passRate).toBeCloseTo(5 / 9, 10);
    expect(stats.categories.math.runs).toBe(6);
    expect(stats.categories.math.passes).toBe(5);
    expect(stats.categories.geo.passRate).toBe(0);
  });

  it("should give a small category a wider interval than a large one", () => {
    const small = caseOf("s", [[1, true], [1, true]], "small");
    const large = caseOf("l", Array.from({ length: 40 }, () => [1, true] as [number, boolean]), "large");
    const stats = computeStats([small, large]);

    const width = (key: string) =>
      stats.categories[key].passRateInterval.high - stats.categories[key].passRateInterval.low;

    expect(width("small")).toBeGreaterThan(width("large") * 5);
  });

  it("should read reports without runs as one sample per case", () => {
    const legacy = caseOf("old", [[0.9, true]]);

    delete legacy.runs;

    const stats = computeStats([legacy]);

    expect(stats.overall.runs).toBe(1);
    expect(stats.overall.meanScore).toBeCloseTo(0.9, 10);
  });
});
