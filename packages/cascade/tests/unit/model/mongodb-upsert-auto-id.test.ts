import { describe, expect, it, vi } from "vitest";
import { findOneAndUpdateRecord, performAtomic } from "../../../src/model/methods/query-methods";
import { createMockDataSource } from "../../utils/test-helpers";

function makeModel({ existing = false }: { existing?: boolean } = {}) {
  const idGenerator = { generateNextId: vi.fn().mockResolvedValue(42) };
  const driver = {
    name: "mongodb",
    atomic: vi
      .fn()
      .mockResolvedValue({ modifiedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ id: existing ? 7 : 42, email: "a@b.c" }),
  };
  const dataSource = createMockDataSource({ driver: driver as any, idGenerator });
  const Model: any = {
    name: "User",
    table: "users",
    primaryKey: "id",
    autoGenerateId: true,
    getDataSource: () => dataSource,
    getDriver: () => driver,
    query: () => ({
      where: () => ({
        pluck: async () => (existing ? [7] : []),
      }),
      withoutGlobalScopes: () => ({ where: () => ({ exists: async () => false }) }),
    }),
    hydrate: (data: Record<string, unknown>) => data,
  };

  return { Model, driver, idGenerator };
}

describe("MongoDB auto-increment upserts", () => {
  it("assigns a numeric id when atomic upsert inserts", async () => {
    const { Model, driver, idGenerator } = makeModel();

    await expect(
      performAtomic(Model, { email: "a@b.c" }, { $set: { name: "Ada" } }, { upsert: true }),
    ).resolves.toBe(1);

    expect(idGenerator.generateNextId).toHaveBeenCalledWith({
      table: "users",
      initialId: 1,
      incrementIdBy: 1,
    });
    expect(driver.atomic).toHaveBeenCalledWith(
      "users",
      { email: "a@b.c" },
      { $set: { name: "Ada" }, $setOnInsert: { id: 42 } },
      { upsert: true },
    );
  });

  it("uses $setOnInsert for findOneAndUpdate, leaving an existing id unchanged", async () => {
    const { Model, driver } = makeModel({ existing: true });

    await expect(
      findOneAndUpdateRecord(
        Model,
        { email: "a@b.c" },
        { $set: { name: "Grace" } },
        { upsert: true },
      ),
    ).resolves.toMatchObject({ id: 7 });

    expect(driver.findOneAndUpdate).toHaveBeenCalledWith(
      "users",
      { email: "a@b.c", id: 7 },
      { $set: { name: "Grace" } },
      { upsert: true },
    );
  });

  it("does not add $setOnInsert.id when an upsert filter supplies id", async () => {
    const { Model, driver, idGenerator } = makeModel();

    await performAtomic(Model, { id: 5 }, { $set: { name: "Ada" } }, { upsert: true });

    expect(idGenerator.generateNextId).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledWith(
      "users",
      { id: 5 },
      { $set: { name: "Ada" } },
      { upsert: true },
    );
  });

  it("does not add $setOnInsert.id when an upsert filter uses $eq for id", async () => {
    const { Model, driver, idGenerator } = makeModel();

    await performAtomic(
      Model,
      { id: { $eq: 5 } },
      { $set: { name: "Ada" } },
      { upsert: true, trustedFilter: true },
    );

    expect(idGenerator.generateNextId).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledWith(
      "users",
      { id: { $eq: 5 } },
      { $set: { name: "Ada" } },
      { upsert: true },
    );
  });

  it("preserves a caller-supplied $setOnInsert.id", async () => {
    const { Model, driver, idGenerator } = makeModel();

    await performAtomic(
      Model,
      { email: "a@b.c" },
      { $setOnInsert: { id: 8, name: "Ada" } },
      { upsert: true },
    );

    expect(idGenerator.generateNextId).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledWith(
      "users",
      { email: "a@b.c" },
      { $setOnInsert: { id: 8, name: "Ada" } },
      { upsert: true },
    );
  });

  it("does not add $setOnInsert.id when $set supplies id", async () => {
    const { Model, driver, idGenerator } = makeModel();

    await performAtomic(
      Model,
      { email: "a@b.c" },
      { $set: { id: 9, name: "Ada" } },
      { upsert: true },
    );

    expect(idGenerator.generateNextId).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledWith(
      "users",
      { email: "a@b.c" },
      { $set: { id: 9, name: "Ada" } },
      { upsert: true },
    );
  });
});
