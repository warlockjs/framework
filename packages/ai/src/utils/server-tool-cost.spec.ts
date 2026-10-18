import { describe, expect, it, vi } from "vitest";
import { agent } from "../agent/agent";
import type { ModelContract, ModelResponse } from "../contracts/model.contract";
import type { Usage } from "../contracts/result/usage.type";
import { budget, memoryScopedBudgetStore } from "../middleware/builtins/budget";
import { attachCost, computeCost, mergeUsage, totalCost } from "./compute-cost";

const pricing = {
  input: 1,
  output: 2,
  serverTools: { webSearch: 0.01, webFetch: 0, vendorRequests: 0.02 },
};
const zero = (): Usage => ({ input: 0, output: 0, total: 0 });
function model(response: ModelResponse) {
  const complete = vi.fn(async () => response);
  const stub: ModelContract = {
    name: "test-model",
    provider: "test",
    pricing,
    complete,
    async *stream() {
      yield { type: "done", ...response };
    },
  };
  return { stub, complete };
}

describe("hosted-tool costs and reservations", () => {
  it("prices requests separately from tokens and includes zero-priced fetches", () => {
    const usage = {
      input: 100,
      output: 200,
      total: 300,
      serverToolUse: { webSearchRequests: 2, webFetchRequests: 3, vendorRequests: 1 },
    };
    const cost = computeCost(usage, pricing);
    expect(cost).toEqual({
      input: 0.0001,
      output: 0.0004,
      serverTools: { webSearch: 0.02, webFetch: 0, vendorRequests: 0.02 },
    });
    expect(totalCost(cost)).toBeCloseTo(0.0405);
    expect(attachCost(usage, pricing).cost).toEqual(cost);
  });

  it("leaves unreported counters and unpriced requests absent", () => {
    expect(computeCost(zero(), pricing)?.serverTools).toBeUndefined();
    expect(
      computeCost({ ...zero(), serverToolUse: { webSearchRequests: 1 } }, { input: 0, output: 0 })
        ?.serverTools,
    ).toBeUndefined();
    expect(computeCost(zero(), undefined)).toBeUndefined();
  });

  it("sums counters and historical server costs without aliasing children", () => {
    const target = zero();
    const child = attachCost(
      { ...zero(), serverToolUse: { webSearchRequests: 2, vendorRequests: 0 } },
      pricing,
    );
    mergeUsage(target, child);
    mergeUsage(target, {
      ...zero(),
      serverToolUse: { webSearchRequests: 3, webFetchRequests: 1 },
      cost: { input: 0, output: 0, serverTools: { webSearch: 0.03 } },
    });
    expect(target.serverToolUse).toEqual({
      webSearchRequests: 5,
      webFetchRequests: 1,
      vendorRequests: 0,
    });
    expect(totalCost(target.cost)).toBeCloseTo(0.05);
    expect(child.serverToolUse?.webSearchRequests).toBe(2);
    expect(child.cost?.serverTools?.webSearch).toBe(0.02);
  });

  it("refuses a search-fee reservation before transport", async () => {
    const { stub, complete } = model({ content: "ok", finishReason: "stop", usage: zero() });
    const result = await agent({
      model: stub,
      middleware: [
        budget({
          maxCostUSD: 0.019,
          reserve: { outputTokens: 0, inputTokens: () => 0, serverToolRequests: 2 },
        }),
      ],
    }).execute("search");
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
    expect(complete).not.toHaveBeenCalled();
  });

  it("settles the actual search fee to the scoped ledger", async () => {
    const store = memoryScopedBudgetStore();
    const { stub } = model({
      content: "ok",
      finishReason: "stop",
      usage: { ...zero(), serverToolUse: { webSearchRequests: 1 } },
    });
    const result = await agent({
      model: stub,
      middleware: [
        budget({
          scoped: { key: "search", window: "day", maxCostUSD: 1, store },
          reserve: { outputTokens: 0, inputTokens: () => 0, serverToolRequests: 5 },
        }),
      ],
    }).execute("search");
    expect(result.error).toBeUndefined();
    const date = new Date();
    const windowStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    expect(
      await store.refund({ key: "search", windowStart, unit: "usd", amount: 0, limit: 1 }, 0),
    ).toBeCloseTo(0.01);
  });

  it("fails closed for a reserved search fee without a rate", async () => {
    const { stub, complete } = model({ content: "ok", finishReason: "stop", usage: zero() });
    const result = await agent({
      model: { ...stub, pricing: { input: 0, output: 0 } },
      middleware: [budget({ maxCostUSD: 1, reserve: { outputTokens: 0, serverToolRequests: 1 } })],
    }).execute("search");
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, Infinity, NaN])("rejects invalid reservation %s", (serverToolRequests) => {
    expect(() => budget({ reserve: { outputTokens: 0, serverToolRequests } })).toThrow(RangeError);
  });
});

it("prices code-execution requests only when reported and explicitly priced", () => {
  const cost = computeCost(
    { input: 0, output: 0, total: 0, serverToolUse: { codeExecutionRequests: 2 } },
    { input: 0, output: 0, serverTools: { codeExecution: 0.04 } },
  );
  expect(cost?.serverTools?.codeExecution).toBe(0.08);
});
