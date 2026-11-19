import { describe, expect, it } from "vitest";
import { emptyRollupDelta } from "../../../src/ai/rollup/extract";
import type { DevtoolsAiRollupDelta, DevtoolsAiRollupStore } from "../../../src/ai/types";
import { HOUR, HOUR_START } from "./helpers";

export const DAY = 24 * HOUR;
export const ALL_TIME = { fromHour: 0, toHour: Number.MAX_SAFE_INTEGER };

/** A delta of one run with some tokens, errors and latency for the given key parts. */
export function deltaFor(
  hour: number,
  agent = "a",
  model = "m",
  provider = "p",
  runs = 1,
): DevtoolsAiRollupDelta {
  const delta = emptyRollupDelta({ hour, agent, model, provider });

  delta.runs = runs;
  delta.completed = runs;
  delta.inputTokens = 100 * runs;
  delta.costUsd = 0.5 * runs;
  delta.pricedRuns = runs;
  delta.errors.tool = runs;
  delta.latency[2] = runs;
  delta.latencyCount = runs;
  delta.latencySumMs = 900 * runs;

  return delta;
}

/** The behaviour every `DevtoolsAiRollupStore` shares. */
export function describeAiRollupStoreContract(
  label: string,
  create: () => Promise<DevtoolsAiRollupStore> | DevtoolsAiRollupStore,
): void {
  describe(`ai rollup store contract: ${label}`, () => {
    it("verifies", async () => {
      expect(await (await create()).verify()).toBe(true);
    });

    it("creates a row on first increment and adds on the next", async () => {
      const store = await create();

      await store.increment([deltaFor(HOUR_START)]);
      await store.increment([deltaFor(HOUR_START, "a", "m", "p", 2)]);

      const rows = await store.list(ALL_TIME);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        runs: 3,
        completed: 3,
        inputTokens: 300,
        pricedRuns: 3,
        latencyCount: 3,
      });
      expect(rows[0].costUsd).toBeCloseTo(1.5);
      expect(rows[0].errors.tool).toBe(3);
      expect(rows[0].latency[2]).toBe(3);
      expect(rows[0].latencySumMs).toBe(2700);
      expect(rows[0].id).toMatch(/^[0-9a-f]{40}$/);
    });

    it("adds two deltas of one key given in the same call", async () => {
      const store = await create();

      await store.increment([deltaFor(HOUR_START), deltaFor(HOUR_START)]);

      expect((await store.list(ALL_TIME))[0].runs).toBe(2);
    });

    it("keeps separate rows per hour, agent, model and provider", async () => {
      const store = await create();

      await store.increment([
        deltaFor(HOUR_START),
        deltaFor(HOUR_START + HOUR),
        deltaFor(HOUR_START, "b"),
        deltaFor(HOUR_START, "a", "n"),
        deltaFor(HOUR_START, "a", "m", "q"),
      ]);

      expect(await store.list(ALL_TIME)).toHaveLength(5);
    });

    it("filters by hour range (inclusive start, exclusive end)", async () => {
      const store = await create();

      await store.increment([
        deltaFor(HOUR_START),
        deltaFor(HOUR_START + HOUR),
        deltaFor(HOUR_START + 2 * HOUR),
      ]);

      const rows = await store.list({ fromHour: HOUR_START, toHour: HOUR_START + 2 * HOUR });

      expect(rows.map((row) => row.hour).sort()).toEqual([HOUR_START, HOUR_START + HOUR]);
    });

    it("filters by exact agent, model and provider", async () => {
      const store = await create();

      await store.increment([
        deltaFor(HOUR_START, "a", "m", "p"),
        deltaFor(HOUR_START, "ab", "m", "p"),
        deltaFor(HOUR_START, "a", "n", "p"),
        deltaFor(HOUR_START, "a", "m", "q"),
      ]);

      expect(await store.list({ ...ALL_TIME, agent: "a" })).toHaveLength(3);
      expect(await store.list({ ...ALL_TIME, agent: "a", model: "m" })).toHaveLength(2);
      expect(await store.list({ ...ALL_TIME, agent: "a", model: "m", provider: "q" })).toHaveLength(
        1,
      );
      expect(await store.list({ ...ALL_TIME, agent: "zzz" })).toHaveLength(0);
    });

    it("splits rows across days", async () => {
      const store = await create();
      const nextDay = Math.floor(HOUR_START / DAY) * DAY + DAY;

      await store.increment([deltaFor(nextDay - HOUR), deltaFor(nextDay)]);

      expect(await store.list(ALL_TIME)).toHaveLength(2);
      expect(await store.list({ fromHour: nextDay, toHour: nextDay + HOUR })).toHaveLength(1);
    });

    it("prunes rows before the cut-off and reports how many", async () => {
      const store = await create();
      const day = Math.floor(HOUR_START / DAY) * DAY;

      await store.increment([
        deltaFor(day - 3 * DAY),
        deltaFor(day - DAY + 5 * HOUR),
        deltaFor(day + 2 * HOUR),
        deltaFor(day + 8 * HOUR),
      ]);

      // Cut inside a day: the boundary day keeps only its later rows.
      expect(await store.prune(day + 5 * HOUR)).toBe(3);
      expect((await store.list(ALL_TIME)).map((row) => row.hour)).toEqual([day + 8 * HOUR]);
      expect(await store.prune(day)).toBe(0);
    });

    it("lists nothing for an empty store", async () => {
      expect(await (await create()).list(ALL_TIME)).toEqual([]);
    });
  });
}
