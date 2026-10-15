import { describe, expect, it, vi } from "vitest";
import {
  findAndReplaceRecord,
  findOneAndUpdateRecord,
} from "../../../src/model/methods/query-methods";

describe("B6: findOneAndUpdate / findAndReplace hydrate the driver result", () => {
  function make() {
    const hydrated = { isNew: false };
    const driver = {
      findOneAndUpdate: vi.fn(async () => ({ id: 7 })),
      replace: vi.fn(async () => ({ id: 7 })),
    };
    const Model: any = {
      name: "Counter",
      table: "counters",
      primaryKey: "id",
      getDriver: () => driver,
      query: () => ({ where: () => ({ pluck: async () => [7] }) }),
      hydrate: vi.fn(() => hydrated),
    };
    return { Model, hydrated };
  }

  it("findOneAndUpdate returns Model.hydrate(result)", async () => {
    const { Model, hydrated } = make();
    const result = await findOneAndUpdateRecord(Model, { id: 7 }, { $set: { x: 1 } } as any);

    expect(Model.hydrate).toHaveBeenCalledWith({ id: 7 });
    expect(result).toBe(hydrated);
  });

  it("findAndReplace returns Model.hydrate(result)", async () => {
    const { Model, hydrated } = make();
    const result = await findAndReplaceRecord(Model, { id: 7 }, { x: 1 });

    expect(Model.hydrate).toHaveBeenCalledWith({ id: 7 });
    expect(result).toBe(hydrated);
  });
});
