import { describe, expect, it, vi } from "vitest";
import { performAtomicIncrement } from "../../../src/model/methods/meta-methods";
import {
  findAndUpdateRecords,
  updateById,
} from "../../../src/model/methods/query-methods";
import { emitModelEvent } from "../../../src/model/methods/instance-event-methods";
import { getModelEvents } from "../../../src/model/methods/static-event-methods";
import { DatabaseDirtyTracker } from "../../../src/database-dirty-tracker";

describe("K3:B17 static listeners walk the base-class chain", () => {
  it("fires a listener registered on a base class for a subclass model", async () => {
    class Base {
      public events = getModelEvents(Object as any);
      public static events() {
        return getModelEvents(this);
      }
    }
    class Child extends Base {}
    const listener = vi.fn();
    Base.events().on("saving", listener);

    const model: any = new Child();
    model.events = { emit: async () => undefined };

    await emitModelEvent(model, "saving", { mode: "insert" });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("K3:B13 atomic increment does not dirty the field", () => {
  it("uses the primary key and keeps the field clean", async () => {
    const atomic = vi.fn(async () => 1);
    const data = { uuid: "u1", views: 5, name: "a" };
    const model: any = {
      data,
      dirtyTracker: new DatabaseDirtyTracker(data),
      trustedPrimaryKey: "u1",
      self: () => ({ primaryKey: "uuid", atomic }),
    };
    model.dirtyTracker.mergeChanges({ name: "b" });

    await performAtomicIncrement(model, "views", 2);

    expect(atomic).toHaveBeenCalledWith({ uuid: "u1" }, { $inc: { views: 2 } });
    expect(model.data.views).toBe(7);
    expect(model.dirtyTracker.isDirty("views")).toBe(false);
    expect(model.dirtyTracker.isDirty("name")).toBe(true);
  });
});

describe("K3:B14 findAndUpdate returns the updated rows", () => {
  it("re-queries by captured ids, not the original filter", async () => {
    const atomic = vi.fn(async () => ({ modifiedCount: 2 }));
    const whereIn = vi.fn(() => ({ get: async () => ["r1", "r2"] }));
    const Model: any = {
      name: "Job",
      table: "jobs",
      primaryKey: "id",
      getDriver: () => ({ atomic }),
      query: () => ({
        where: () => ({ pluck: async () => [1, 2] }),
        whereIn,
      }),
    };

    const rows = await findAndUpdateRecords(Model, { status: "pending" }, {
      $set: { status: "processing" },
    } as any);

    expect(whereIn).toHaveBeenCalledWith("id", [1, 2]);
    expect(rows).toEqual(["r1", "r2"]);
  });
});

describe("K3:B12 Model.update goes through the writer", () => {
  it("loads, merges and saves instead of a raw $set", async () => {
    const model = { merge: vi.fn(), save: vi.fn(async () => undefined) };
    const Model: any = {
      primaryKey: "id",
      query: () => ({ where: () => ({ first: async () => model }) }),
    };

    expect(await updateById(Model, 1, { name: "x" })).toBe(1);
    expect(model.merge).toHaveBeenCalledWith({ name: "x" });
    expect(model.save).toHaveBeenCalled();
  });

  it("returns 0 when no visible row exists", async () => {
    const Model: any = {
      primaryKey: "id",
      query: () => ({ where: () => ({ first: async () => null }) }),
    };

    expect(await updateById(Model, 9, {})).toBe(0);
  });
});
