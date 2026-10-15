import { describe, expect, it, vi } from "vitest";
import { UnsafeFilterError } from "../../errors/unsafe-filter.error";
import { findAndUpdateRecords, findOneAndUpdateRecord, performAtomic } from "./query-methods";

function makeModel() {
  const rows = [
    { id: 1, tenant: 1, status: "pending" },
    { id: 2, tenant: 1, status: "pending" },
    { id: 3, tenant: 2, status: "pending" },
  ];
  const atomic = vi.fn(async (_table, filter, update) => {
    const ids = (filter.id as { $in: number[] }).$in;
    for (const row of rows.filter((row) => ids.includes(row.id))) Object.assign(row, update.$set);
    return { modifiedCount: ids.length };
  });
  const findOneAndUpdate = vi.fn(async (_table, filter, update) => {
    const row = rows.find((row) => row.id === filter.id);
    if (!row) return null;
    Object.assign(row, update.$set);
    return row;
  });
  const scopedIds = (filter: Record<string, any>) =>
    rows
      .filter((row) => row.tenant === 1 && (!filter.id?.$in || filter.id.$in.includes(row.id)))
      .map((row) => row.id);
  const Model: any = {
    name: "Post",
    table: "posts",
    primaryKey: "id",
    getDriver: () => ({ atomic, findOneAndUpdate }),
    query: () => ({
      where: (filter: Record<string, unknown>) => {
        if (Object.values(filter).some((value: any) => value?.$in))
          throw new UnsafeFilterError("unsafe");
        return { pluck: async () => scopedIds(filter) };
      },
      whereTrusted: (filter: Record<string, unknown>) => ({ pluck: async () => scopedIds(filter) }),
      whereIn: (_field: string, ids: number[]) => ({
        get: async () => rows.filter((row) => ids.includes(row.id)),
      }),
    }),
    hydrate: (row: any) => row,
  };
  return { Model, rows, atomic, findOneAndUpdate };
}

describe("trusted write filters", () => {
  const operatorFilter = { id: { $in: [1, 2, 3] } };

  it("findAndUpdate accepts trusted operators, updates visible matches, and retains scopes", async () => {
    const { Model, rows } = makeModel();

    const updated = await findAndUpdateRecords(
      Model,
      operatorFilter,
      { $set: { status: "done" } },
      { trustedFilter: true },
    );

    expect(updated).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(["done", "done", "pending"]);
  });

  it("continues rejecting untrusted operator filters", async () => {
    const { Model } = makeModel();

    await expect(
      findAndUpdateRecords(Model, operatorFilter, { $set: { status: "done" } }),
    ).rejects.toThrow(UnsafeFilterError);
  });

  it("lets atomic and findOneAndUpdate use trusted operator filters through scopes", async () => {
    const { Model, atomic, findOneAndUpdate } = makeModel();

    await expect(
      performAtomic(Model, operatorFilter, { $set: { status: "done" } }, { trustedFilter: true }),
    ).resolves.toBe(2);
    await expect(
      findOneAndUpdateRecord(
        Model,
        operatorFilter,
        { $set: { status: "closed" } },
        { trustedFilter: true },
      ),
    ).resolves.toMatchObject({ id: 1 });
    expect(atomic).toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalled();
  });
});
