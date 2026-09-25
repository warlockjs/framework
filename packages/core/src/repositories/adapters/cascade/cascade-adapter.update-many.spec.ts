import { describe, expect, it, vi } from "vitest";
import { CascadeAdapter, UPDATE_MANY_BATCH_SIZE } from "./cascade-adapter";

function fakeRecords(count: number) {
  return Array.from({ length: count }, () => ({ save: vi.fn(async () => undefined) }));
}

/** Model double whose query().chunk() serves `records` in `size` pieces. */
function fakeModel(records: ReturnType<typeof fakeRecords>) {
  const log: string[] = [];
  const chunkSizes: number[] = [];

  const query = {
    where: vi.fn(),
    chunk: async (size: number, cb: (rows: any[], index: number) => Promise<unknown>) => {
      chunkSizes.push(size);
      for (let i = 0, index = 0; i < records.length; i += size, index++) {
        await cb(records.slice(i, i + size), index);
      }
    },
  };

  const model = {
    query: () => query,
    transaction: async (fn: () => Promise<unknown>) => {
      log.push("begin");
      await fn();
      log.push("commit");
    },
  };

  return { model, log, chunkSizes };
}

describe("CascadeAdapter.updateMany", () => {
  it("writes in batches of 500, one transaction per batch", async () => {
    const records = fakeRecords(UPDATE_MANY_BATCH_SIZE + 1);
    const { model, log, chunkSizes } = fakeModel(records);

    const count = await new CascadeAdapter(model as any).updateMany({ a: 1 }, { b: 2 });

    expect(count).toBe(501);
    expect(chunkSizes).toEqual([500]);
    expect(log).toEqual(["begin", "commit", "begin", "commit"]);
    expect(records[0]!.save).toHaveBeenCalledWith({ merge: { b: 2 } });
  });

  it("still updates when the model has no transaction support", async () => {
    const records = fakeRecords(3);
    const { model } = fakeModel(records);
    delete (model as any).transaction;

    expect(await new CascadeAdapter(model as any).updateMany({}, { b: 2 })).toBe(3);
    expect(records[2]!.save).toHaveBeenCalled();
  });
});
