import { computeCost, totalCost } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";
import { OPENAI_MODEL_LIFECYCLE, openAILifecycleFor } from "./known-lifecycle";
import { OPENAI_MODEL_PRICING, OPENAI_MODEL_PRICING_AS_OF, openAIPricingFor } from "./known-pricing";

// Plain ids OpenAI documents only through dated snapshots or variants, so no status is claimed.
const WITHOUT_STATUS = ["gpt-5.2", "gpt-4o", "gpt-4o-mini"];

describe("OpenAI model tables", () => {
  it("dates the pricing table", () => {
    expect(OPENAI_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(Object.keys(OPENAI_MODEL_PRICING).filter((id) => !WITHOUT_STATUS.includes(id)))(
    "gives %s a status",
    (id) => {
      expect(openAILifecycleFor(id)?.status).toMatch(/^(current|retiring|retired)$/);
    },
  );

  it.each(Object.entries(OPENAI_MODEL_LIFECYCLE))("%s has a consistent lifecycle", (id, lifecycle) => {
    expect(OPENAI_MODEL_PRICING[id]).toBeDefined();

    if (lifecycle.status === "current") {
      expect(lifecycle.retiresOn).toBeUndefined();
    } else {
      expect(lifecycle.retiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lifecycle.replacement).toBeTruthy();
    }
  });

  it("marks past shutdown dates retired and later ones retiring", () => {
    for (const lifecycle of Object.values(OPENAI_MODEL_LIFECYCLE)) {
      if (lifecycle.status === "retired") {
        expect(lifecycle.retiresOn! <= OPENAI_MODEL_PRICING_AS_OF).toBe(true);
      }

      if (lifecycle.status === "retiring") {
        expect(lifecycle.retiresOn! > OPENAI_MODEL_PRICING_AS_OF).toBe(true);
      }
    }
  });

  it("keeps the retired ids priced", () => {
    for (const id of ["o1", "o3-mini", "o4-mini", "gpt-4.1-nano"]) {
      expect(openAILifecycleFor(id)?.status).toBe("retired");
      expect(openAIPricingFor(id)).toBeDefined();
    }
  });

  it("knows the retiring ids", () => {
    expect(openAILifecycleFor("gpt-5")).toEqual({
      status: "retiring",
      retiresOn: "2026-12-11",
      replacement: "gpt-5.6-sol",
    });
    expect(openAILifecycleFor("o3")?.retiresOn).toBe("2026-12-11");
    expect(openAILifecycleFor("gpt-5.1")?.retiresOn).toBe("2027-04-01");
    expect(openAILifecycleFor("nope")).toBeUndefined();
  });

  it("prices every listed model with rates", () => {
    for (const pricing of Object.values(OPENAI_MODEL_PRICING)) {
      expect(pricing.input).toBeGreaterThan(0);
      expect(pricing.output).toBeGreaterThan(0);
    }
  });

  it("bills gpt-6.1-terra by prompt length", () => {
    const pricing = openAIPricingFor("gpt-6.1-terra");
    const short = { input: 100_000, output: 10_000, total: 110_000, cachedTokens: 50_000 };
    const long = { input: 300_000, output: 10_000, total: 310_000, cachedTokens: 100_000 };

    expect(totalCost(computeCost(short, pricing))).toBeCloseTo(
      (50_000 * 1 + 50_000 * 0.05 + 10_000 * 5) / 1e6,
    );
    expect(totalCost(computeCost(long, pricing))).toBeCloseTo(
      (200_000 * 2 + 100_000 * 0.1 + 10_000 * 7.5) / 1e6,
    );
  });

  it("prices gpt-6-cyber flat", () => {
    expect(openAIPricingFor("gpt-6-cyber")).toEqual({ input: 20, output: 100, cachedInput: 2 });
  });

  it("reports the 1.05M window for gpt-6 models", () => {
    expect(inferContextWindow("gpt-6.1-terra")).toBe(1_050_000);
  });
});
