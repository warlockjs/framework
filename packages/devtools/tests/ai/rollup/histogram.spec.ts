import { describe, expect, it } from "vitest";
import { DEVTOOLS_AI_LATENCY_BUCKETS_MS } from "../../../src/production/contracts";
import {
  addAiLatency,
  aiLatencyBucket,
  aiLatencyQuantile,
  emptyAiLatency,
} from "../../../src/ai/rollup/histogram";

describe("ai latency histogram", () => {
  it("has one more count than bounds", () => {
    expect(emptyAiLatency()).toHaveLength(DEVTOOLS_AI_LATENCY_BUCKETS_MS.length + 1);
    expect(emptyAiLatency()).toHaveLength(16);
  });

  it("puts a value in the first bucket whose bound is not below it", () => {
    expect(aiLatencyBucket(0)).toBe(0);
    expect(aiLatencyBucket(250)).toBe(0);
    expect(aiLatencyBucket(251)).toBe(1);
    expect(aiLatencyBucket(500)).toBe(1);
    expect(aiLatencyBucket(300_000)).toBe(14);
  });

  it("puts anything above the last bound in the overflow bucket", () => {
    expect(aiLatencyBucket(300_001)).toBe(15);
  });

  it("counts negative and non-finite values as 0", () => {
    expect(aiLatencyBucket(-5)).toBe(0);
    expect(aiLatencyBucket(Number.NaN)).toBe(0);
    expect(aiLatencyBucket(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("adds histograms in place", () => {
    const target = emptyAiLatency();

    target[2] = 1;
    addAiLatency(target, [1, 0, 2, ...new Array(13).fill(0)]);

    expect(target.slice(0, 3)).toEqual([1, 0, 3]);
  });

  it("answers the bucket upper bound of a quantile", () => {
    const counts = emptyAiLatency();

    counts[0] = 50; // <= 250
    counts[2] = 40; // <= 1000
    counts[5] = 10; // <= 5000

    expect(aiLatencyQuantile(counts, 0.5)).toBe(250);
    expect(aiLatencyQuantile(counts, 0.9)).toBe(1000);
    expect(aiLatencyQuantile(counts, 0.95)).toBe(5000);
    expect(aiLatencyQuantile(counts, 1)).toBe(5000);
  });

  it("answers the last bound for the overflow bucket", () => {
    const counts = emptyAiLatency();

    counts[15] = 3;

    expect(aiLatencyQuantile(counts, 0.5)).toBe(300_000);
  });

  it("answers null when empty", () => {
    expect(aiLatencyQuantile(emptyAiLatency(), 0.5)).toBeNull();
  });
});
