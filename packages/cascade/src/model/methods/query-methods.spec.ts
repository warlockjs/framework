import { describe, expect, it, vi } from "vitest";
import { UnsafeFilterError } from "../../errors/unsafe-filter.error";
import { findAndUpdateRecords, findOneAndUpdateRecord, performAtomic } from "./query-methods";

function makeModel() {
  const rows = [
    { id: 1, tenant: 1, status: "pending" },
    { id: 2, tenant: 1, status: "pending" },
    { id: 3, tenant: 2, status: "pending" },
  ];
  const atomic = vi.fn(async (_table, filter, update, _options?: unknown) => {
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

describe("findAndUpdate with upsert", () => {
  it("updates every matching row instead of the first one", async () => {
    const { Model, rows, atomic } = makeModel();

    const updated = await findAndUpdateRecords(
      Model,
      { tenant: 1 },
      { $set: { status: "done" } },
      { upsert: true },
    );

    expect(updated).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(["done", "done", "pending"]);
    expect(atomic).toHaveBeenCalledTimes(1);
    expect(atomic.mock.calls[0]![3]).not.toHaveProperty("upsert", true);
  });
});

describe("upsert ids", () => {
  function upsertModel(driverName: string) {
    const generate = vi.fn(async () => 99);
    const atomic = vi.fn(async () => ({ modifiedCount: 0, upsertedCount: 1 }));
    const Model: any = {
      name: "Post",
      table: "posts",
      primaryKey: "id",
      autoGenerateId: true,
      getDriver: () => ({ name: driverName, atomic }),
      getDataSource: () => ({ idGenerator: { generateNextId: generate } }),
      query: () => ({
        where: () => ({ pluck: async () => [], exists: async () => false }),
        withoutGlobalScopes: () => ({
          where: () => ({ pluck: async () => [], exists: async () => false }),
        }),
      }),
    };

    return { Model, atomic, generate };
  }

  it("hands the driver an insert-time id instead of reserving one up front", async () => {
    const { Model, atomic, generate } = upsertModel("mongodb");

    await performAtomic(Model, { slug: "a" }, { $set: { title: "A" } }, { upsert: true });

    const [, , operations, options] = atomic.mock.calls[0]! as any[];

    expect(generate).not.toHaveBeenCalled();
    expect(operations).toEqual({ $set: { title: "A" } });
    expect(options.idOnInsert.field).toBe("id");
    await expect(options.idOnInsert.generate()).resolves.toBe(99);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("leaves the id to the caller when the update supplies one", async () => {
    const { Model, atomic } = upsertModel("mongodb");

    await performAtomic(Model, { slug: "a" }, { $set: { id: 5 } }, { upsert: true });

    expect((atomic.mock.calls[0]! as any[])[3]).not.toHaveProperty("idOnInsert");
  });

  it("adds no id option on a driver that generates its own", async () => {
    const { Model, atomic } = upsertModel("postgres");

    await performAtomic(Model, { slug: "a" }, { $set: { title: "A" } }, { upsert: true });

    expect((atomic.mock.calls[0]! as any[])[3]).not.toHaveProperty("idOnInsert");
  });
});

describe("scoped atomic writes", () => {
  it("writes through the scoped builder in one call, without resolving ids", async () => {
    const builderAtomic = vi.fn(async () => 4);
    const pluck = vi.fn();
    const where = vi.fn(() => ({ atomic: builderAtomic, pluck }));
    const driverAtomic = vi.fn();
    const Model: any = {
      name: "Post",
      table: "posts",
      primaryKey: "id",
      getDriver: () => ({ atomic: driverAtomic }),
      query: () => ({ where, atomic: builderAtomic }),
    };

    await expect(
      performAtomic(Model, { status: "pending" }, { $set: { status: "done" } }),
    ).resolves.toBe(4);

    expect(where).toHaveBeenCalledWith({ status: "pending" });
    expect(builderAtomic).toHaveBeenCalledWith(
      { $set: { status: "done" } },
      { arrayFilters: undefined },
    );
    expect(pluck).not.toHaveBeenCalled();
    expect(driverAtomic).not.toHaveBeenCalled();
  });
});
