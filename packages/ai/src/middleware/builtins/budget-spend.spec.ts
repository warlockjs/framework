import { describe, expect, it, vi } from "vitest";
import { agent } from "../../agent/agent";
import { ScopedBudgetExceededError } from "../../errors";
import { MockSDK } from "../../mock/mock-sdk";
import { budget, memoryScopedBudgetStore, type BudgetSpend } from "./budget";

const pricing = { "gpt-test": { input: 10, output: 10 } };

function make(middleware: ReturnType<typeof budget>) {
  const model = MockSDK({
    responses: [{ content: "ok", usage: { input: 100_000, output: 0 } }],
  }).model({ name: "gpt-test" });

  return { model, agent: agent({ model, middleware: [middleware] }) };
}

describe("budget — onSpend", () => {
  it("reports each call's cost and the running totals", async () => {
    const spends: BudgetSpend[] = [];
    const { agent: ai } = make(
      budget({ maxCostUSD: 5, pricing, onSpend: (spend) => void spends.push(spend) }),
    );

    await ai.execute("hi", { sessionId: "s1" });

    expect(spends).toHaveLength(1);
    expect(spends[0]).toMatchObject({
      model: "gpt-test",
      provider: "mock",
      sessionId: "s1",
      tripIndex: 0,
      costUSD: 1,
      run: { tokens: 100_000, costUSD: 1 },
    });
  });

  it("fires before the cap check, so the breaching call is recorded", async () => {
    const onSpend = vi.fn();
    const { agent: ai } = make(budget({ maxCostUSD: 0.5, pricing, onSpend }));

    const result = await ai.execute("hi");

    expect(result.error).toBeDefined();
    expect(onSpend).toHaveBeenCalledOnce();
  });

  it("ignores a failing hook", async () => {
    const { agent: ai } = make(
      budget({
        maxCostUSD: 5,
        pricing,
        onSpend: async () => {
          throw new Error("db down");
        },
      }),
    );

    expect((await ai.execute("hi")).error).toBeUndefined();
  });
});

describe("budget — per-session window", () => {
  it("caps a session across runs with window 'all' and refuses before the call when reserving", async () => {
    const store = memoryScopedBudgetStore();
    const guard = budget({
      pricing,
      reserve: { outputTokens: 0, inputTokens: () => 100_000 },
      scoped: {
        key: (context) => `session:${context.options?.sessionId}`,
        window: "all",
        maxCostUSD: 1.5,
        store,
      },
    });
    const { agent: ai, model } = make(guard);

    expect((await ai.execute("a", { sessionId: "s1" })).error).toBeUndefined();

    const second = await ai.execute("b", { sessionId: "s1" });

    expect(second.error).toBeInstanceOf(ScopedBudgetExceededError);
    expect(model.callCount).toBe(1);

    // Another session has its own ledger.
    expect((await ai.execute("c", { sessionId: "s2" })).error).toBeUndefined();
  });
});
