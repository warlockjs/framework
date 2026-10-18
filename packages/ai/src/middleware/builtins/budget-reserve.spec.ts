import { tool } from "../../tool/tool";
import { describe, expect, it, vi } from "vitest";
import { agent } from "../../agent/agent";
import { BudgetExceededError, InvalidRequestError, ProviderOverloadedError } from "../../errors";
import { MockSDK } from "../../mock/mock-sdk";
import { countInputTokens } from "../../utils/estimate-input-tokens";
import type { Message } from "../../contracts/conversation-message.type";
import type { ModelCallOptions } from "../../contracts/model.contract";
import { budget, memoryScopedBudgetStore, type ScopedBudgetStore } from "./budget";

function todayStart(): number {
  const now = new Date();

  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Read the current ledger value without changing it. */
async function ledger(store: ScopedBudgetStore, key: string, unit: "tokens" | "usd") {
  return store.refund({ key, windowStart: todayStart(), unit, amount: 0, limit: 0 }, 0);
}

describe("budget — reserve-then-commit", () => {
  it("refuses a call whose worst case would cross the cap, before calling the model", async () => {
    const sdk = MockSDK({
      responses: [{ content: "small", usage: { input: 10, output: 10, total: 20 } }],
    });
    const model = sdk.model({ name: "m" });
    const result = await agent({
      model,
      middleware: [budget({ maxTokens: 1_000, reserve: { outputTokens: 4_096 } })],
    }).execute("hi");

    expect(result.error).toBeInstanceOf(BudgetExceededError);
    expect((result.error as BudgetExceededError).context).toMatchObject({ reason: "reservation" });
    expect(sdk.models[0]?.callHistory).toHaveLength(0);
  });

  it("lets the call through when the worst case fits", async () => {
    const result = await agent({
      model: MockSDK({
        responses: [{ content: "ok", usage: { input: 10, output: 10, total: 20 } }],
      }).model({ name: "m" }),
      middleware: [budget({ maxTokens: 1_000, reserve: { outputTokens: 100 } })],
    }).execute("hi");

    expect(result.error).toBeUndefined();
  });

  it.each([1_000, 20])(
    "reserves with system and tools when native counting is unsupported (cap %s)",
    async (maxTokens) => {
      const sdk = MockSDK({
        responses: [{ content: "ok", usage: { input: 7, output: 3, total: 10 } }],
      });
      const mock = sdk.model({ name: "gemini-like", pricing: { input: 1, output: 1 } });
      const countTokens = vi.fn(async (_messages: Message[], options?: ModelCallOptions) => {
        if (options?.tools?.length)
          throw new InvalidRequestError("cannot count tools", { reason: "count-unsupported" });
        return 1;
      });
      const model = {
        name: mock.name,
        provider: "google",
        pricing: mock.pricing,
        countTokens,
        complete: mock.complete.bind(mock),
        stream: mock.stream.bind(mock),
      };
      const tools = [
        tool({ name: "lookup", description: "Look up data", execute: async () => "ok" }),
      ];
      const store = memoryScopedBudgetStore();
      const result = await agent({
        model,
        systemPrompt: "Follow the rules",
        tools,
        middleware: [
          budget({
            maxTokens,
            maxCostUSD: 0.01,
            scoped: { key: "count-fallback", window: "day", maxTokens, store },
            reserve: {
              outputTokens: 100,
              inputTokens: async (ctx) =>
                (await countInputTokens(model, [...ctx.messages], { tools, signal: ctx.signal }))
                  .tokens,
            },
          }),
        ],
      }).execute("hi");
      expect(countTokens).toHaveBeenCalledTimes(1);
      expect(countTokens.mock.calls[0]?.[0]).toContainEqual({
        role: "system",
        content: "Follow the rules",
      });
      if (maxTokens === 20) {
        expect(result.error).toBeInstanceOf(BudgetExceededError);
        expect(sdk.models[0]?.callHistory).toHaveLength(0);
        expect(await ledger(store, "count-fallback", "tokens")).toBe(0);
      } else {
        expect(result.error).toBeUndefined();
        expect(sdk.models[0]?.callHistory).toHaveLength(1);
        expect(await ledger(store, "count-fallback", "tokens")).toBe(10);
      }
    },
  );

  it("reserves cost at the uncached input rate and checks it against maxCostUSD", async () => {
    const result = await agent({
      model: MockSDK({ responses: [{ content: "ok" }] }).model({
        name: "m",
        pricing: { input: 10, output: 100 },
      }),
      // 1,000 reserved output tokens at $100 / 1M = $0.10 > $0.05 cap.
      middleware: [budget({ maxCostUSD: 0.05, reserve: { outputTokens: 1_000 } })],
    }).execute("hi");

    expect(result.error).toBeInstanceOf(BudgetExceededError);
    expect((result.error as BudgetExceededError).unit).toBe("usd");
  });

  it("commits the actual usage to the scoped ledger in place of the reservation", async () => {
    const store = memoryScopedBudgetStore();
    const result = await agent({
      model: MockSDK({
        responses: [{ content: "ok", usage: { input: 7, output: 3, total: 10 } }],
      }).model({ name: "m" }),
      middleware: [
        budget({
          scoped: { key: "tenant.1", window: "day", maxTokens: 10_000, store },
          reserve: { outputTokens: 2_000, inputTokens: () => 500 },
        }),
      ],
    }).execute("hi");

    expect(result.error).toBeUndefined();
    expect(await ledger(store, "tenant.1", "tokens")).toBe(10);
  });

  it("releases the reservation when the call fails", async () => {
    const store = memoryScopedBudgetStore();
    const result = await agent({
      model: MockSDK({
        responses: [{ content: "", error: new ProviderOverloadedError("busy") }],
      }).model({ name: "m" }),
      middleware: [
        budget({
          scoped: { key: "tenant.2", window: "day", maxTokens: 10_000, store },
          reserve: { outputTokens: 2_000 },
        }),
      ],
    }).execute("hi");

    expect(result.error).toBeDefined();
    expect(await ledger(store, "tenant.2", "tokens")).toBe(0);
  });

  it("stops concurrent runs from jointly overspending a shared scoped cap", async () => {
    const store = memoryScopedBudgetStore();
    const makeRun = () => {
      const sdk = MockSDK({
        responses: [{ content: "ok", usage: { input: 100, output: 100, total: 200 } }],
      });

      return {
        sdk,
        run: agent({
          model: sdk.model({ name: "m" }),
          middleware: [
            budget({
              scoped: { key: "tenant.3", window: "day", maxTokens: 3_000, store },
              reserve: { outputTokens: 1_000, inputTokens: () => 0 },
            }),
          ],
        }),
      };
    };
    const runs = Array.from({ length: 5 }, makeRun);

    const results = await Promise.all(runs.map(({ run }) => run.execute("hi")));
    const called = runs.filter(({ sdk }) => (sdk.models[0]?.callHistory.length ?? 0) > 0);

    // 3,000 / 1,000 per reservation: at most three calls can be in flight.
    expect(called.length).toBeLessThanOrEqual(3);
    expect(results.filter((result) => result.error === undefined).length).toBe(called.length);
    expect(await ledger(store, "tenant.3", "tokens")).toBe(called.length * 200);
  });

  it("prices with a ModelPricing budget entry, cache rates included", async () => {
    const result = await agent({
      model: MockSDK({
        responses: [
          {
            content: "ok",
            usage: { input: 1_000_000, output: 0, total: 1_000_000, cachedTokens: 1_000_000 },
          },
        ],
      }).model({ name: "m" }),
      // Fully cached input at $0.1 / 1M = $0.10; the full input rate would be $10.
      middleware: [
        budget({ maxCostUSD: 0.5, pricing: { m: { input: 10, output: 10, cachedInput: 0.1 } } }),
      ],
    }).execute("hi");

    expect(result.error).toBeUndefined();
  });
});
