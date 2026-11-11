import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { findAndUpdateRecords } from "../../../src/model/methods/query-methods";
import { Model } from "../../../src/model/model";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * Atomic writes on a model with no global scope go straight to the driver;
 * a model with a scope (or a fetch listener, or its own query) still resolves
 * the visible rows first.
 */

const driver = createMockDriver();
(driver as any).atomic = vi.fn(async () => ({ modifiedCount: 1 }));

beforeAll(() => {
  dataSourceRegistry.register({ name: "test", driver, isDefault: true });
});

afterAll(() => {
  dataSourceRegistry.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function pinnedQuery(ids: unknown[]) {
  return { where: () => ({ pluck: async () => ids }) } as any;
}

describe("atomic writes and the scope lookup", () => {
  it("issues exactly one driver call for a model without scopes", async () => {
    class Counter extends Model {
      public static table = "counters";
    }

    await Counter.atomic({ name: "views" }, { $inc: { value: 1 } });

    // No query was built to look the rows up first.
    expect(driver.queryBuilder).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledTimes(1);
    expect((driver.atomic as any).mock.calls[0][1]).toEqual({ name: "views" });
  });

  it("increments a loaded model with one driver call and keeps it clean", async () => {
    class Counter extends Model {
      public static table = "counters";
    }

    const counter = new Counter({ id: 1, name: "views", value: 4 });
    counter.isNew = false;

    await counter.atomicIncrement("value", 2);

    expect(driver.queryBuilder).not.toHaveBeenCalled();
    expect(driver.atomic).toHaveBeenCalledTimes(1);
    expect(counter.get("value")).toBe(6);
    expect(counter.hasChanges()).toBe(false);

    counter.set("name", "clicks");

    expect(counter.getDirtyColumnsWithValues()).toEqual({
      name: { oldValue: "views", newValue: "clicks" },
    });
  });

  it("keeps other pending changes dirty after an increment", async () => {
    class Counter extends Model {
      public static table = "counters";
    }

    const counter = new Counter({ id: 1, name: "views", value: 4 });
    counter.isNew = false;
    counter.set("name", "clicks");

    await counter.atomicIncrement("value");

    expect(counter.getDirtyColumns()).toEqual(["name"]);
    expect(counter.get("value")).toBe(5);
  });

  it("still pins the write to visible rows for a scoped model", async () => {
    class Scoped extends Model {
      public static table = "scoped";
    }

    Scoped.addGlobalScope("tenant", (query) => query.where("tenantId", 1));
    vi.spyOn(Scoped, "query").mockReturnValue(pinnedQuery([7]));

    await Scoped.atomic({ name: "a" }, { $set: { x: 1 } });

    expect((driver.atomic as any).mock.calls[0][1]).toEqual({ name: "a", id: { $in: [7] } });
  });

  it("still resolves the rows when a fetching listener is registered", async () => {
    class Watched extends Model {
      public static table = "watched";
    }

    Watched.events().on("fetching", () => {});
    const query = vi.spyOn(Watched, "query").mockReturnValue(pinnedQuery([3]));

    await Watched.atomic({ name: "a" }, { $set: { x: 1 } });

    expect(query).toHaveBeenCalledTimes(1);
    expect((driver.atomic as any).mock.calls[0][1]).toEqual({ name: "a", id: { $in: [3] } });
  });

  it("still resolves the rows when the model overrides query()", async () => {
    class Custom extends Model {
      public static table = "custom";

      public static override query(): any {
        return pinnedQuery([9]);
      }
    }

    await Custom.atomic({ name: "a" }, { $set: { x: 1 } });

    expect((driver.atomic as any).mock.calls[0][1]).toEqual({ name: "a", id: { $in: [9] } });
  });
});

describe("findAndUpdate", () => {
  it("resolves the matching ids once and writes to exactly those", async () => {
    const pluck = vi.fn(async () => [7, 8]);
    const atomic = vi.fn(async () => ({ modifiedCount: 2 }));
    const get = vi.fn(async () => []);
    const FakeModel: any = {
      name: "Post",
      table: "posts",
      primaryKey: "id",
      getDriver: () => ({ atomic }),
      query: () => ({
        where: () => ({ pluck }),
        whereIn: () => ({ get }),
      }),
    };

    await findAndUpdateRecords(FakeModel, { status: "draft" }, { $set: { status: "live" } } as any);

    expect(pluck).toHaveBeenCalledTimes(1);
    expect(atomic).toHaveBeenCalledWith(
      "posts",
      { id: { $in: [7, 8] } },
      { $set: { status: "live" } },
      undefined,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});
