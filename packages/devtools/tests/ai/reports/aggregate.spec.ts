import { describe, expect, it } from "vitest";
import {
  breakdown,
  errorGroups,
  errorRateSeries,
  errorSeries,
  filterOptions,
  modelRows,
  seriesBy,
  tokenSeries,
  totalsOf,
} from "../../../src/ai/reports/aggregate";
import { H, row } from "./fixtures";

const from = 1_000 * H;
const range = { preset: "24h" as const, from, to: from + 4 * H, stepMs: H, utcOffsetMinutes: 0 };

describe("totalsOf", () => {
  it("sums counters, error rate and latency", () => {
    const latency = new Array<number>(16).fill(0);
    latency[0] = 8;
    latency[3] = 2;
    const totals = totalsOf([
      row(
        { hour: from },
        {
          runs: 6,
          completed: 4,
          failed: 1,
          incomplete: 1,
          inputTokens: 100,
          outputTokens: 10,
          cachedTokens: 40,
          costUsd: 0.5,
          pricedRuns: 6,
          latency,
          latencyCount: 10,
          latencySumMs: 5000,
        },
      ),
      row(
        { hour: from + H, agent: "b" },
        { runs: 4, completed: 4, unpricedRuns: 4, unpricedTokens: 50, cancelled: 0 },
      ),
    ]);

    expect(totals.runs).toBe(10);
    expect(totals.errorRate).toBeCloseTo(0.2);
    expect(totals.tokens).toMatchObject({ input: 100, output: 10, cached: 40 });
    expect(totals.cost).toEqual({
      estimatedUsd: 0.5,
      pricedRuns: 6,
      unpricedRuns: 4,
      unpricedTokens: 50,
    });
    expect(totals.latency.p50Ms).toBe(250);
    expect(totals.latency.meanMs).toBe(500);
  });

  it("is zero and null for no rows", () => {
    const totals = totalsOf([]);

    expect(totals.errorRate).toBe(0);
    expect(totals.latency).toEqual({ p50Ms: null, p95Ms: null, meanMs: null });
  });
});

describe("series", () => {
  it("names the top five and sums the rest into Other, with zero gaps", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((model, index) =>
      row({ hour: from + (index % 2) * H, model }, { runs: 1, costUsd: 10 - index }),
    );
    const set = seriesBy(
      rows,
      range,
      (r) => r.model,
      (k) => k.toUpperCase(),
      (r) => r.costUsd,
    );

    expect(set.buckets).toHaveLength(4);
    expect(set.series.map((s) => s.key)).toEqual(["a", "b", "c", "d", "e", "__other"]);
    const other = set.series.at(-1);
    expect(other).toMatchObject({ label: "Other", other: true });
    expect(other?.values).toEqual([4, 5, 0, 0]);
    expect(set.series[0]?.label).toBe("A");
    expect(set.series[0]?.values[2]).toBe(0);
  });

  it("ignores rows outside the range", () => {
    const set = seriesBy(
      [row({ hour: from - H }, { runs: 1 })],
      range,
      (r) => r.model,
      (k) => k,
      (r) => r.runs,
    );

    expect(set.series).toEqual([]);
  });

  it("splits tokens into uncached, cached and output", () => {
    const set = tokenSeries(
      [row({ hour: from }, { inputTokens: 100, cachedTokens: 30, outputTokens: 7 })],
      range,
    );

    expect(set.series.map((s) => [s.key, s.values[0]])).toEqual([
      ["uncached", 70],
      ["cached", 30],
      ["output", 7],
    ]);
  });

  it("gives null rate for buckets without runs", () => {
    const points = errorRateSeries([row({ hour: from + H }, { runs: 4, failed: 1 })], range);

    expect(points.map((p) => p.rate)).toEqual([null, 0.25, null, null]);
  });

  it("builds failed runs by category", () => {
    const set = errorSeries(
      [row({ hour: from }, { failed: 3, errors: { "rate-limit": 2, timeout: 1 } as never })],
      range,
    );

    expect(set.series.map((s) => s.key)).toEqual(["rate-limit", "timeout"]);
    expect(set.series[0]?.label).toBe("Rate limit");
  });
});

describe("breakdown, models and errors", () => {
  const rows = [
    row({ hour: from, agent: "a", model: "m1" }, { runs: 2, costUsd: 3, pricedRuns: 2 }),
    row(
      { hour: from, agent: "b", model: "m2", provider: "anthropic" },
      { runs: 5, unpricedRuns: 5, unpricedTokens: 9 },
    ),
    row(
      { hour: from + H, agent: "a", model: "m1" },
      {
        runs: 1,
        costUsd: 1,
        pricedRuns: 1,
        unpricedRuns: 1,
        fallbackRuns: 1,
        failed: 1,
        errors: { provider: 1 } as never,
      },
    ),
  ];

  it("orders by cost, falls back to runs when nothing is priced", () => {
    const top = breakdown(rows, "agent", 10);

    expect(top.map((r) => r.key)).toEqual(["a", "b"]);
    expect(top[0]?.share).toBeCloseTo(1);
    expect(top[0]?.provider).toBeNull();
    expect(breakdown(rows, "model", 1)).toHaveLength(1);

    const unpriced = breakdown([rows[1]!], "model", 10);
    expect(unpriced[0]).toMatchObject({ key: "anthropic/m2", provider: "anthropic", share: 1 });
  });

  it("rates pricing per model", () => {
    const models = modelRows(rows);

    expect(models.map((m) => [m.key, m.pricing])).toEqual([
      ["anthropic/m2", "missing"],
      ["openai/m1", "partial"],
    ]);
    const m1 = models[1]!;
    expect(m1.costPerRunUsd).toBeCloseTo(4 / 3);
    expect(m1.fallbackRate).toBeCloseTo(1 / 3);
    expect(m1.lastSeenAt).toBe(from + H);
    expect(models[0]?.costPerRunUsd).toBeNull();
  });

  it("says no-tokens, not pricing set, for a model whose runs used no tokens", () => {
    const [model] = modelRows([
      row({ hour: from, model: "m3", provider: "openai" }, { runs: 2, failed: 2 }),
    ]);

    expect(model?.pricing).toBe("no-tokens");
  });

  it("groups errors with previous counts", () => {
    const groups = errorGroups(rows, [
      row({ hour: from - H }, { errors: { provider: 4 } as never }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      category: "provider",
      label: "Provider error",
      count: 1,
      share: 1,
      previousCount: 4,
    });
    expect(groups[0]?.byModel).toEqual([{ key: "openai/m1", count: 1 }]);
  });

  it("lists distinct filter values sorted", () => {
    expect(filterOptions(rows)).toEqual({
      agents: ["a", "b"],
      models: ["anthropic/m2", "openai/m1"],
      providers: ["anthropic", "openai"],
    });
  });
});
