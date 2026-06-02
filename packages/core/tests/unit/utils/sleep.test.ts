import { describe, expect, it } from "vitest";
import { sleep } from "../../../src/utils/sleep";

describe("sleep", () => {
  it("returns a promise that resolves after the given delay", async () => {
    const start = Date.now();

    await sleep(40);

    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  it("resolves to undefined", async () => {
    expect(await sleep(1)).toBeUndefined();
  });

  it("does not block the event loop before resolving", async () => {
    const order: string[] = [];

    const pending = sleep(20).then(() => {
      order.push("slept");
    });

    order.push("sync");

    await pending;

    expect(order).toEqual(["sync", "slept"]);
  });
});
