import { computeCost } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { GOOGLE_MODEL_LIFECYCLE, googleLifecycleFor } from "./known-lifecycle";
import {
  GOOGLE_MODEL_PRICING,
  GOOGLE_MODEL_PRICING_AS_OF,
  googlePricingFor,
} from "./known-pricing";

const usage = (input: number, output: number) => ({ input, output, total: input + output });

describe("Google model tables", () => {
  it("dates the pricing table", () => {
    expect(GOOGLE_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(Object.keys(GOOGLE_MODEL_PRICING))("gives priced model %s a status", (id) => {
    expect(googleLifecycleFor(id)?.status).toBe("current");
  });

  it("keeps lifecycle dates consistent with their status", () => {
    for (const lifecycle of Object.values(GOOGLE_MODEL_LIFECYCLE)) {
      if (lifecycle.status === "retiring") {
        expect(lifecycle.retiresOn! > GOOGLE_MODEL_PRICING_AS_OF).toBe(true);
      }

      if (lifecycle.status === "retired" && lifecycle.retiresOn) {
        expect(lifecycle.retiresOn <= GOOGLE_MODEL_PRICING_AS_OF).toBe(true);
      }

      if (lifecycle.status !== "current") {
        expect(lifecycle.replacement).toBeTruthy();
      }
    }
  });

  it("knows the models Google reroutes", () => {
    expect(googleLifecycleFor("models/gemini-2.5-pro")).toEqual({
      status: "retiring",
      retiresOn: "2026-12-01",
      replacement: "gemini-3.8-flash",
    });
    expect(googleLifecycleFor("gemini-3.5-flash")?.status).toBe("retired");
    expect(googleLifecycleFor("nope")).toBeUndefined();
  });

  it("doubles gemini-4-argon on 2026-12-01", () => {
    const pricing = googlePricingFor("gemini-4-argon");

    expect(computeCost(usage(1_000_000, 1_000_000), pricing, { at: "2026-11-30" })?.input).toBeCloseTo(2);
    expect(computeCost(usage(1_000_000, 1_000_000), pricing, { at: "2026-11-30" })?.output).toBeCloseTo(10);
    expect(computeCost(usage(1_000_000, 1_000_000), pricing, { at: "2026-12-01" })?.input).toBeCloseTo(4);
    expect(computeCost(usage(1_000_000, 1_000_000), pricing, { at: "2026-12-01" })?.output).toBeCloseTo(20);
  });

  it("doubles the 3.6 and 3.8 Flash models on 2027-01-01", () => {
    for (const id of ["gemini-3.6-flash", "gemini-3.8-flash"]) {
      const pricing = googlePricingFor(id);

      expect(computeCost(usage(1_000_000, 0), pricing, { at: "2026-12-31" })?.input).toBeCloseTo(0.75);
      expect(computeCost(usage(1_000_000, 0), pricing, { at: "2027-01-01" })?.input).toBeCloseTo(1.5);
    }
  });

  it("bills gemini-3.1-pro-preview prompts over 200K at the higher rates", () => {
    const pricing = googlePricingFor("gemini-3.1-pro-preview");

    expect(computeCost(usage(200_000, 1_000_000), pricing)?.output).toBeCloseTo(12);
    expect(computeCost(usage(200_001, 1_000_000), pricing)?.output).toBeCloseTo(18);
  });
});
