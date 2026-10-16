import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./map-with-concurrency";

function deferred<TValue>() {
  let resolve!: (value: TValue) => void;
  const promise = new Promise<TValue>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order even when later items settle first", async () => {
    const delays = [30, 5, 15, 0];

    const results = await mapWithConcurrency(delays, 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));

      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` mappers at once", async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
      },
    );

    expect(peak).toBe(3);
  });

  it("starts the next item as soon as one settles", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];

    const done = mapWithConcurrency([0, 1, 2], 2, async (item) => {
      started.push(item);
      await gates[item]!.promise;

      return item;
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    gates[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2]);

    gates[0]!.resolve();
    gates[2]!.resolve();
    expect(await done).toEqual([0, 1, 2]);
  });

  it("resolves an empty list without calling the mapper", async () => {
    let calls = 0;

    expect(
      await mapWithConcurrency([], 4, async () => {
        calls++;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it("treats a limit below one as one", async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3], 0, async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
    });

    expect(peak).toBe(1);
  });
});
