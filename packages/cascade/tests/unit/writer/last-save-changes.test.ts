import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class Priced extends Model {
  static table = "priced";
  static autoGenerateId = false;
  static schema = v.object({ price: v.number(), name: v.string() });
}

const loaded = () => {
  const model = new Priced({ id: 1, name: "a", price: 10 });
  model.isNew = false;
  model.dirtyTracker.reset();
  return model;
};

describe("changes are available to saved / updated listeners", () => {
  const driver = createMockDriver();

  beforeEach(() => {
    vi.spyOn(Priced, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
  });

  it("an updated listener sees old and new values in the context and on the model", async () => {
    const model = loaded();
    let seen: any;
    let viaModel: any;
    model.on("updated", (m, context: any) => {
      seen = context.changes;
      viaModel = m.getLastSaveChanges();
    });

    model.set("price", 12);
    await new DatabaseWriter(model).save();

    expect(seen.price).toEqual({ oldValue: 10, newValue: 12 });
    expect(viaModel.price).toEqual({ oldValue: 10, newValue: 12 });
    expect(model.getLastSaveChanges().price).toEqual({ oldValue: 10, newValue: 12 });
    expect(model.hasChanges()).toBe(false);
  });

  it("a saved listener sees them too, with the changed column list", async () => {
    const model = loaded();
    let context: any;
    model.on("saved", (_m, ctx) => {
      context = ctx;
    });

    model.set("name", "b");
    await new DatabaseWriter(model).save();

    expect(context.changes.name).toEqual({ oldValue: "a", newValue: "b" });
    expect(context.changedColumns).toContain("name");
    expect(context.isInsert).toBe(false);
  });

  it("an insert has an empty diff", async () => {
    const model = new Priced({ id: 2, name: "n", price: 1 });
    let context: any;
    model.on("saved", (_m, ctx) => {
      context = ctx;
    });

    await new DatabaseWriter(model).save();

    expect(context.isInsert).toBe(true);
    expect(context.changes).toEqual({});
    expect(model.getLastSaveChanges()).toEqual({});
  });

  it("a listener that saves again gets a fresh diff and the outer event keeps its own", async () => {
    const model = loaded();
    const contexts: any[] = [];
    let nested = false;

    model.on("saved", async (m, ctx: any) => {
      contexts.push(ctx.changes);
      if (!nested) {
        nested = true;
        m.set("name", "z");
        await new DatabaseWriter(m).save();
      }
    });
    let updatedChanges: any;
    let updatedViaModel: any;
    model.on("updated", (m, ctx: any) => {
      updatedChanges = ctx.changes;
      updatedViaModel = m.getLastSaveChanges();
    });

    model.set("price", 20);
    await new DatabaseWriter(model).save();

    expect(Object.keys(contexts[0])).toContain("price");
    expect(Object.keys(contexts[0])).not.toContain("name");
    expect(contexts[1].name).toEqual({ oldValue: "a", newValue: "z" });
    expect(contexts[1].price).toBeUndefined();
    expect(updatedChanges.price).toEqual({ oldValue: 10, newValue: 20 });
    expect(updatedViaModel.price).toEqual({ oldValue: 10, newValue: 20 });
  });
});
