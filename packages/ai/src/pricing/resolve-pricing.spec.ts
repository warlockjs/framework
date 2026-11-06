import { describe, expect, it } from "vitest";
import type { ModelPricing } from "../contracts/result/model-pricing.type";
import type { Usage } from "../contracts/result/usage.type";
import { computeCost, totalCost } from "../utils/compute-cost";
import { resolvePricing } from "./resolve-pricing";

const TIERED: ModelPricing = {
  input: 1,
  output: 5,
  cachedInput: 0.05,
  tiers: [{ abovePromptTokens: 272_000, input: 2, output: 7.5, cachedInput: 0.1 }],
};

const SCHEDULED: ModelPricing = {
  input: 2,
  output: 10,
  cachedInput: 0.1,
  schedule: [{ from: "2026-12-01", input: 4, output: 20, cachedInput: 0.2 }],
};

describe("resolvePricing", () => {
  it("returns a flat pricing as it is", () => {
    const flat: ModelPricing = { input: 1, output: 2 };

    expect(resolvePricing(flat, { promptTokens: 10_000_000 })).toBe(flat);
  });

  it("uses the base rates up to the threshold and the tier above it", () => {
    expect(resolvePricing(TIERED, { promptTokens: 272_000 })).toEqual({
      input: 1,
      output: 5,
      cachedInput: 0.05,
    });
    expect(resolvePricing(TIERED, { promptTokens: 272_001 })).toEqual({
      input: 2,
      output: 7.5,
      cachedInput: 0.1,
    });
  });

  it("applies no tier when the prompt length is unknown", () => {
    expect(resolvePricing(TIERED).input).toBe(1);
  });

  it("picks the highest matching tier and keeps base fields a tier leaves out", () => {
    const pricing: ModelPricing = {
      input: 1,
      output: 2,
      cacheWrite: 1.25,
      tiers: [
        { abovePromptTokens: 200_000, input: 3 },
        { abovePromptTokens: 100_000, input: 2 },
      ],
    };

    expect(resolvePricing(pricing, { promptTokens: 150_000 })).toEqual({
      input: 2,
      output: 2,
      cacheWrite: 1.25,
    });
    expect(resolvePricing(pricing, { promptTokens: 250_000 }).input).toBe(3);
  });

  it("switches to a dated tariff on its day, in UTC", () => {
    expect(resolvePricing(SCHEDULED, { at: "2026-11-30T23:59:59Z" }).input).toBe(2);
    expect(resolvePricing(SCHEDULED, { at: "2026-12-01T00:00:00Z" })).toEqual({
      input: 4,
      output: 20,
      cachedInput: 0.2,
    });
    expect(resolvePricing(SCHEDULED, { at: new Date("2027-06-01") }).output).toBe(20);
  });

  it("uses the latest tariff in effect when several have started", () => {
    const pricing: ModelPricing = {
      input: 1,
      output: 1,
      schedule: [
        { from: "2027-01-01", input: 3 },
        { from: "2026-06-01", input: 2 },
      ],
    };

    expect(resolvePricing(pricing, { at: "2026-07-01" }).input).toBe(2);
    expect(resolvePricing(pricing, { at: "2027-02-01" }).input).toBe(3);
  });

  it("applies a tariff's own tiers on top of its rates", () => {
    const pricing: ModelPricing = {
      input: 1,
      output: 2,
      schedule: [
        {
          from: "2026-12-01",
          input: 2,
          tiers: [{ abovePromptTokens: 100, input: 5 }],
        },
      ],
    };

    expect(resolvePricing(pricing, { at: "2026-12-02", promptTokens: 200 }).input).toBe(5);
    expect(resolvePricing(pricing, { at: "2026-11-01", promptTokens: 200 }).input).toBe(1);
  });
});

describe("computeCost with tiers and tariffs", () => {
  it("bills a long OpenAI-style prompt at the tier rates", () => {
    const usage: Usage = { input: 300_000, output: 1_000, total: 301_000, cachedTokens: 100_000 };
    const cost = computeCost(usage, TIERED);

    expect(cost?.input).toBeCloseTo((200_000 * 2) / 1e6);
    expect(cost?.cachedInput).toBeCloseTo((100_000 * 0.1) / 1e6);
    expect(cost?.output).toBeCloseTo((1_000 * 7.5) / 1e6);
  });

  it("bills a short prompt at the base rates", () => {
    const usage: Usage = { input: 1_000, output: 1_000, total: 2_000 };

    expect(totalCost(computeCost(usage, TIERED))).toBeCloseTo((1_000 * 1 + 1_000 * 5) / 1e6);
  });

  it("counts cache reads and writes in the prompt length when input excludes them", () => {
    const usage: Usage = {
      input: 10,
      output: 100,
      total: 110,
      cachedTokens: 60_000,
      cacheWriteTokens: 40_000,
      inputIncludesCache: false,
    };
    const pricing: ModelPricing = {
      input: 0.1,
      output: 0.5,
      cachedInput: 0.01,
      cacheWrite: 0.125,
      tiers: [
        { abovePromptTokens: 100_000, input: 0.5, output: 2.5, cachedInput: 0.05, cacheWrite: 0.625 },
      ],
    };

    expect(computeCost(usage, pricing)?.output).toBeCloseTo((100 * 2.5) / 1e6);
    expect(computeCost({ ...usage, cachedTokens: 10_000 }, pricing)?.output).toBeCloseTo(
      (100 * 0.5) / 1e6,
    );
  });

  it("costs at the date given", () => {
    const usage: Usage = { input: 1_000_000, output: 0, total: 1_000_000 };

    expect(computeCost(usage, SCHEDULED, { at: "2026-11-01" })?.input).toBeCloseTo(2);
    expect(computeCost(usage, SCHEDULED, { at: "2026-12-01" })?.input).toBeCloseTo(4);
  });
});
