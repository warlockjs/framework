import { describe, expect, it, vi } from "vitest";
import { rollupId } from "../../../src/ai/rollup/extract";
import { DevtoolsAiRollupIncrementError } from "../../../src/ai/rollup/increment-error";
import { HOUR_START } from "./helpers";
import { deltaFor } from "./store-contract";

const atomic = vi.fn();

vi.mock("../../../src/production/store/models", () => ({
  DevtoolsAiRollupRow: {
    table: "devtools_ai_rollups",
    getDataSource: () => ({}),
    atomic: (...args: unknown[]) => atomic(...args),
  },
}));

const { createCascadeAiRollupStore } = await import("../../../src/ai/rollup/cascade-store");

describe("cascade ai rollup store increment", () => {
  it("tries every delta and reports only the ones that failed", async () => {
    const deltas = Array.from({ length: 12 }, (_, index) => deltaFor(HOUR_START, `agent-${index}`));
    const failing = new Set([rollupId(deltas[3]!), rollupId(deltas[11]!)]);

    atomic.mockReset();
    atomic.mockImplementation(async (filter: { id: string }) => {
      if (failing.has(filter.id)) throw new Error("deadlock detected");
    });

    const store = await createCascadeAiRollupStore();
    const failure = await store.increment(deltas).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(atomic).toHaveBeenCalledTimes(12);
    expect(failure).toBeInstanceOf(DevtoolsAiRollupIncrementError);
    expect(
      (failure as DevtoolsAiRollupIncrementError).unwritten.map((delta) => delta.agent),
    ).toEqual(["agent-3", "agent-11"]);
    expect((failure as Error).message).toBe("2 of 12 AI totals were not saved (deadlock detected)");
  });

  it("rethrows the error itself when nothing was saved", async () => {
    atomic.mockReset();
    atomic.mockRejectedValue(new Error("connection refused"));

    const store = await createCascadeAiRollupStore();

    await expect(store.increment([deltaFor(HOUR_START)])).rejects.toThrow("connection refused");
    await expect(store.increment([deltaFor(HOUR_START)])).rejects.not.toBeInstanceOf(
      DevtoolsAiRollupIncrementError,
    );
  });

  it("upserts by id with the counters as $inc", async () => {
    atomic.mockReset();
    atomic.mockResolvedValue({ modifiedCount: 1 });

    const store = await createCascadeAiRollupStore({ now: () => 42 });
    const delta = deltaFor(HOUR_START);

    await store.increment([delta]);

    const [filter, operations, options] = atomic.mock.calls[0]!;

    expect(filter).toEqual({ id: rollupId(delta) });
    expect(operations).toMatchObject({
      $set: { updated_at: 42 },
      $setOnInsert: { hour: HOUR_START, agent: "a", model: "m", provider: "p" },
      $inc: { runs: 1 },
    });
    expect(options).toEqual({ upsert: true, trustedFilter: true });
  });
});
