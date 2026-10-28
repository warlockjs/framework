import { describe, expect, it } from "vitest";
import { agent } from "../agent/agent";
import { budget } from "../middleware/builtins/budget";
import { BudgetExceededError } from "../errors";
import { MockSDK } from "../mock/mock-sdk";
import { isPricingCatalogue, pricingCatalogue } from "./pricing-catalogue";

const CLAUDE = { "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } };
const GPT = { "gpt-4o": { input: 2.5, output: 10 }, "claude-sonnet-4-6": { input: 1, output: 1 } };

describe("pricingCatalogue", () => {
  it("looks models up across tables, later tables winning", () => {
    const prices = pricingCatalogue({ tables: [CLAUDE] }).use(GPT);

    expect(prices.get("gpt-4o")).toEqual({ input: 2.5, output: 10 });
    expect(prices.get("claude-sonnet-4-6")).toEqual({ input: 1, output: 1 });
    expect(prices.get("unknown")).toBeUndefined();
    expect(prices.models().sort()).toEqual(["claude-sonnet-4-6", "gpt-4o"]);
  });

  it("lets overrides beat every table and resolves dated snapshots", () => {
    const prices = pricingCatalogue({ tables: [CLAUDE] }).set("claude-sonnet-4-6", {
      input: 2,
      output: 8,
    });

    expect(prices.get("claude-sonnet-4-6-20250929")).toEqual({ input: 2, output: 8 });
    expect(pricingCatalogue({ tables: [CLAUDE] }).get("claude-sonnet-4-6-2025-09-29")?.input).toBe(3);
  });

  it("does not resolve inherited object keys", () => {
    expect(pricingCatalogue({ tables: [CLAUDE] }).get("constructor")).toBeUndefined();
    expect(pricingCatalogue().get("__proto__")).toBeUndefined();
  });

  it("computes cost from usage, and undefined for an unpriced model", () => {
    const prices = pricingCatalogue({ tables: [CLAUDE] });
    const usage = {
      input: 100,
      output: 1_000,
      total: 51_100,
      cachedTokens: 50_000,
      cacheWriteTokens: 0,
      inputIncludesCache: false,
    };

    expect(prices.cost(usage, "claude-sonnet-4-6")?.cachedInput).toBeCloseTo(0.015, 10);
    expect(prices.costUSD(usage, "claude-sonnet-4-6")).toBeCloseTo(0.0003 + 0.015 + 0.015, 10);
    expect(prices.costUSD(usage, "nope")).toBeUndefined();
  });

  it("exports a plain record and is recognised by isPricingCatalogue", () => {
    const prices = pricingCatalogue({ tables: [CLAUDE] });

    expect(prices.toRecord()).toEqual(CLAUDE);
    expect(isPricingCatalogue(prices)).toBe(true);
    expect(isPricingCatalogue({ get: () => undefined })).toBe(false);
  });

  it("prices a USD cap in budget() from a catalogue", async () => {
    const sdk = MockSDK({
      responses: [{ content: "ok", usage: { input: 1_000_000, output: 0 } }],
    });
    const model = sdk.model({ name: "gpt-4o" });
    const prices = pricingCatalogue({ tables: [GPT] });

    const result = await agent({
      model,
      middleware: [budget({ maxCostUSD: 1, pricing: prices })],
    }).execute("hi");

    expect(result.error).toBeInstanceOf(BudgetExceededError);
    expect((result.error as BudgetExceededError).actual).toBeCloseTo(2.5, 10);
  });

  it("fails closed when the catalogue has no price for the model", async () => {
    const model = MockSDK({ responses: [{ content: "ok" }] }).model({ name: "mystery" });

    const result = await agent({
      model,
      middleware: [budget({ maxCostUSD: 1, pricing: pricingCatalogue({ tables: [GPT] }) })],
    }).execute("hi");

    expect(result.error).toBeInstanceOf(BudgetExceededError);
    expect(model.callCount).toBe(0);
  });
});
