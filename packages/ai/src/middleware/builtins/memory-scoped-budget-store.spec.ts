import { describe, expect, it } from "vitest";
import {
  memoryScopedBudgetStore,
  memoryScopedBudgetStoreSizes,
} from "./memory-scoped-budget-store";
import type { ScopedBudgetReserveInput } from "./scoped-budget-store.type";

function reserveInput(overrides: Partial<ScopedBudgetReserveInput> = {}): ScopedBudgetReserveInput {
  return { key: "user-1", windowStart: 0, unit: "tokens", amount: 1, limit: 5, ...overrides };
}

describe("memoryScopedBudgetStore", () => {
  it("releases every per-key queue once the keys go idle", async () => {
    const store = memoryScopedBudgetStore();

    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        store.reserve(reserveInput({ key: `user-${index}` })),
      ),
    );

    expect(memoryScopedBudgetStoreSizes(store)?.queues).toBe(0);
  });

  it("still serializes concurrent reservations on one key", async () => {
    const store = memoryScopedBudgetStore();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.reserve(reserveInput())),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(memoryScopedBudgetStoreSizes(store)?.queues).toBe(0);
  });

  it("drops ledger entries of windows older than the previous one", async () => {
    const store = memoryScopedBudgetStore();

    for (let window = 0; window < 6; window++) {
      await store.reserve(reserveInput({ windowStart: window * 1000 }));
    }

    expect(memoryScopedBudgetStoreSizes(store)?.ledger).toBe(2);
  });

  it("keeps the previous window so a settle after rollover sees its reservation", async () => {
    const store = memoryScopedBudgetStore();
    const before = reserveInput({ windowStart: 0, amount: 4 });

    await store.reserve(before);
    await store.reserve(reserveInput({ windowStart: 1000 }));

    expect(await store.commit(before, 2)).toEqual({ allowed: true, used: 2 });
    expect(await store.refund(before, 1)).toBe(1);
  });

  it("enforces each window's limit independently", async () => {
    const store = memoryScopedBudgetStore();

    expect((await store.reserve(reserveInput({ amount: 5 }))).allowed).toBe(true);
    expect((await store.reserve(reserveInput({ amount: 1 }))).allowed).toBe(false);
    expect((await store.reserve(reserveInput({ windowStart: 1000, amount: 5 }))).allowed).toBe(
      true,
    );
  });
});
