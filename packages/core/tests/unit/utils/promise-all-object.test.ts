import { describe, expect, it } from "vitest";
import { promiseAllObject } from "../../../src/utils/promise-all-object";

describe("promiseAllObject", () => {
  it("resolves each promise and maps results back to their keys", async () => {
    const result = await promiseAllObject({
      user: Promise.resolve({ id: 1 }),
      total: Promise.resolve(42),
    });

    expect(result).toEqual({ user: { id: 1 }, total: 42 });
  });

  it("returns an empty object for empty input", async () => {
    expect(await promiseAllObject({})).toEqual({});
  });

  it("resolves all promises concurrently, not sequentially", async () => {
    const order: string[] = [];

    const make = (label: string, delay: number) => {
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          order.push(label);
          resolve(label);
        }, delay);
      });
    };

    const result = await promiseAllObject({
      slow: make("slow", 30),
      fast: make("fast", 5),
    });

    expect(result).toEqual({ slow: "slow", fast: "fast" });
    expect(order).toEqual(["fast", "slow"]);
  });

  it("rejects when any promise rejects", async () => {
    await expect(
      promiseAllObject({
        ok: Promise.resolve(1),
        bad: Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
  });
});
