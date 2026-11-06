import { computeCost } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { XaiSDK } from "./sdk";
import { inferContextWindow } from "./known-context-windows";
import { XAI_MODEL_LIFECYCLE, xaiLifecycleFor } from "./known-lifecycle";
import { XAI_CHAT_MODELS } from "./known-models";
import { XAI_MODEL_PRICING, XAI_MODEL_PRICING_AS_OF, xaiPricingFor } from "./known-pricing";

// Older Grok ids that xAI's current model page does not list, so no status is claimed.
const LEGACY = ["grok-4", "grok-3", "grok-3-mini", "grok-2-vision", "grok-2"];

describe("xAI model tables", () => {
  it("dates the pricing table", () => {
    expect(XAI_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(XAI_CHAT_MODELS.filter((id) => !LEGACY.includes(id)))(
    "gives listed model %s a status, a window and a price",
    (id) => {
      expect(xaiLifecycleFor(id)?.status).toBe("current");
      expect(inferContextWindow(id)).toBeGreaterThan(0);
      expect(xaiPricingFor(id)?.input).toBeGreaterThan(0);
    },
  );

  it("keeps every priced model in the lifecycle table", () => {
    expect(Object.keys(XAI_MODEL_PRICING).sort()).toEqual(Object.keys(XAI_MODEL_LIFECYCLE).sort());
  });

  it("reports the documented windows", () => {
    expect(inferContextWindow("grok-4.7")).toBe(500_000);
    expect(inferContextWindow("grok-4.5")).toBe(500_000);
    expect(inferContextWindow("grok-4.3")).toBe(1_000_000);
    expect(inferContextWindow("grok-4.20-0309-reasoning")).toBe(1_000_000);
    expect(inferContextWindow("grok-build-0.1")).toBe(256_000);
    expect(inferContextWindow("grok-4")).toBe(256_000);
    expect(inferContextWindow("grok-4-fast")).toBe(2_000_000);
  });

  it("bills grok-4.3 at the long-prompt rates from 200K prompt tokens", () => {
    const usage = (input: number) => ({ input, output: 1_000_000, total: input + 1_000_000 });
    const pricing = xaiPricingFor("grok-4.3");

    expect(computeCost(usage(199_999), pricing)?.output).toBeCloseTo(2.5);
    expect(computeCost(usage(200_000), pricing)?.output).toBeCloseTo(5);
  });

  it("leaves unlisted ids unpriced", () => {
    expect(xaiPricingFor("grok-3")).toBeUndefined();
    expect(xaiLifecycleFor("grok-3")).toBeUndefined();
  });

  it("prices a model built by the SDK, letting any pricing you pass win", () => {
    const sdk = new XaiSDK({ apiKey: "test" });

    expect(sdk.model({ name: "grok-4.3" }).pricing).toEqual(xaiPricingFor("grok-4.3"));
    expect(sdk.model({ name: "grok-3" }).pricing).toBeUndefined();
    expect(sdk.model({ name: "grok-4.3", pricing: { input: 1, output: 2 } }).pricing).toEqual({
      input: 1,
      output: 2,
    });
    expect(
      new XaiSDK({ apiKey: "test", pricing: { "grok-4.3": { input: 9, output: 9 } } }).model({
        name: "grok-4.3",
      }).pricing,
    ).toEqual({ input: 9, output: 9 });
  });
});
