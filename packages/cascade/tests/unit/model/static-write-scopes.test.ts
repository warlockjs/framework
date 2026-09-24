import { describe, expect, it, vi } from "vitest";
import {
  findOneAndDeleteRecord,
  findOneAndUpdateRecord,
  performAtomic,
  updateById,
} from "../../../src/model/methods/query-methods";

// A model whose scoped query only sees tenant 1 rows; the driver records the filter it is issued.
function makeModel() {
  const rows = [{ id: 7, tenant: 1, name: "a" }];
  const driver = {
    atomic: vi.fn(async () => ({ modifiedCount: 1 })),
    update: vi.fn(async () => ({ modifiedCount: 1 })),
    findOneAndUpdate: vi.fn(async () => ({ id: 7 })),
    findOneAndDelete: vi.fn(async () => ({ id: 7 })),
    replace: vi.fn(async () => ({ id: 7 })),
  };
  const scopedWhere = vi.fn((filter: Record<string, unknown>) => ({
    pluck: async () => (filter.name === "a" || filter.id === 7 ? rows.map((row) => row.id) : []),
    withoutGlobalScopes: () => ({ where: () => ({ exists: async () => false }) }),
  }));

  const Model: any = {
    name: "Post",
    table: "posts",
    primaryKey: "id",
    getDriver: () => driver,
    query: () => ({ where: scopedWhere }),
    hydrate: (data: any) => ({ ...data, dirtyTracker: { reset: () => {} } }),
  };

  return { Model, driver };
}

describe("static write methods honour global scopes", () => {
  it("atomic pins the issued filter to scope-visible ids", async () => {
    const { Model, driver } = makeModel();

    await performAtomic(Model, { name: "a" }, { $set: { x: 1 } } as any);

    expect(driver.atomic).toHaveBeenCalledWith(
      "posts",
      { name: "a", id: { $in: [7] } },
      expect.anything(),
      undefined,
    );
  });

  it("does not touch the driver when the scope hides every match", async () => {
    const { Model, driver } = makeModel();

    expect(await performAtomic(Model, { name: "other-tenant" }, {} as any)).toBe(0);
    expect(await updateById(Model, 99, { name: "x" })).toBe(0);
    expect(await findOneAndDeleteRecord(Model, { name: "other-tenant" })).toBeNull();
    expect(await findOneAndUpdateRecord(Model, { name: "other-tenant" }, {} as any)).toBeNull();
    expect(driver.atomic).not.toHaveBeenCalled();
    expect(driver.update).not.toHaveBeenCalled();
    expect(driver.findOneAndDelete).not.toHaveBeenCalled();
    expect(driver.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("findOneAndDelete issues a scoped single-row filter", async () => {
    const { Model, driver } = makeModel();

    await findOneAndDeleteRecord(Model, { name: "a" });

    expect(driver.findOneAndDelete).toHaveBeenCalledWith("posts", { name: "a", id: 7 }, undefined);
  });
});
