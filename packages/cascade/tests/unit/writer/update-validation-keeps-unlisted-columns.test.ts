import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class Listed extends Model {
  static table = "listed";
  static autoGenerateId = false;
  static schema = v.object({ name: v.string() });
}

describe("B2: update never unsets columns absent from the schema", () => {
  const driver = createMockDriver();

  beforeEach(() => {
    vi.spyOn(Listed, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
  });

  it("only writes the dirty, validated field", async () => {
    const model = new Listed({ id: 1, name: "a", postsCount: 3, migratedCol: "x" });
    model.isNew = false;
    model.dirtyTracker.reset();
    model.set("name", "b");

    await new DatabaseWriter(model).save();

    const operations = (driver.update as any).mock.calls.at(-1)[2];
    expect(operations.$unset).toBeUndefined();
    expect(operations.$set).toMatchObject({ name: "b" });
    expect(model.get("postsCount")).toBe(3);
    expect(model.get("migratedCol")).toBe("x");
  });
});
