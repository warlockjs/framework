import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlDatabaseDirtyTracker } from "../../../src/sql-database-dirty-tracker";
import { Model } from "../../../src/model/model";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class Doc extends Model {
  static table = "docs";
  static autoGenerateId = false;
  static schema = v.object({ name: v.string(), nested: v.any().optional() });
}

describe("nested object updates write the exact new shape", () => {
  const driver = createMockDriver();

  beforeEach(() => {
    vi.spyOn(Doc, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
  });

  function persisted(data: Record<string, unknown>): Doc {
    const model = new Doc({ id: 1, name: "doc", ...data });
    model.isNew = false;
    model.dirtyTracker.reset();

    return model;
  }

  async function save(model: Doc): Promise<Record<string, any>> {
    await new DatabaseWriter(model).save();

    return (driver.update as any).mock.calls.at(-1)[2];
  }

  describe("replacing a nested object", () => {
    it("writes the whole object when the new one has fewer keys", async () => {
      const model = persisted({ nested: { a: 1, b: { c: 2 }, d: [1] } });

      model.set("nested", { a: 1 });

      const operations = await save(model);

      expect(operations.$set.nested).toEqual({ a: 1 });
      expect(operations.$unset).toBeUndefined();
      expect(Object.keys(operations.$set).some(key => key.startsWith("nested."))).toBe(false);
    });

    it("writes an empty object when the new one is {}", async () => {
      const model = persisted({ nested: { a: 1 } });

      model.set("nested", {});

      const operations = await save(model);

      expect(operations.$set.nested).toEqual({});
      expect(operations.$unset).toBeUndefined();
    });

    it("writes the whole object when keys are changed and added too", async () => {
      const model = persisted({ nested: { a: 1, b: 2 } });

      model.set("nested", { a: 9, z: 3 });

      const operations = await save(model);

      expect(operations.$set.nested).toEqual({ a: 9, z: 3 });
      expect(operations.$unset).toBeUndefined();
    });

    it("never sends both the field and a path under it", async () => {
      const model = persisted({ nested: { a: 1, b: 2 } });

      model.set("nested.a", 5);
      model.set("nested", { c: 1 });

      const operations = await save(model);

      expect(operations.$set.nested).toEqual({ c: 1 });
      expect(Object.keys(operations.$set).filter(key => key.startsWith("nested."))).toEqual([]);
      expect(operations.$unset).toBeUndefined();
    });

    it("replacing an object with a scalar does not also unset its leaves", async () => {
      const model = persisted({ nested: { a: 1 } });

      model.set("nested", null);

      const operations = await save(model);

      expect(operations.$set.nested).toBeNull();
      expect(operations.$unset).toBeUndefined();
    });

    it("writes nothing for the field when the new object equals the old one", async () => {
      const model = persisted({ nested: { a: 1 } });

      model.set("nested", { a: 1 });
      model.set("name", "renamed");

      const operations = await save(model);

      expect(operations.$set ?? {}).not.toHaveProperty("nested");
      expect(operations.$unset).toBeUndefined();
    });
  });

  describe("dotted-path sets stay partial", () => {
    it("writes only the touched path", async () => {
      const model = persisted({ nested: { a: 1, b: 2 } });

      model.set("nested.a", 5);

      const operations = await save(model);

      expect(operations.$set["nested.a"]).toBe(5);
      expect(operations.$set ?? {}).not.toHaveProperty("nested");
      expect(operations.$set).not.toHaveProperty("nested.b");
      expect(operations.$unset).toBeUndefined();
    });

    it("merge() stays partial", async () => {
      const model = persisted({ nested: { a: 1, b: 2 } });

      model.merge({ nested: { a: 7 } });

      const operations = await save(model);

      expect(operations.$set["nested.a"]).toBe(7);
      expect(operations.$set ?? {}).not.toHaveProperty("nested");
    });
  });

  describe("unset", () => {
    it("removes the parent when the last nested key is unset", async () => {
      const model = persisted({ nested: { x: 1 } });

      model.unset("nested.x");

      expect(model.get("nested")).toBeUndefined();
      expect(model.has("nested")).toBe(false);

      const operations = await save(model);

      expect(operations.$unset).toEqual({ nested: 1 });
    });

    it("removes every parent the unset emptied, and no more", async () => {
      const model = persisted({ a: { b: { c: 1 }, d: 2 } });

      model.unset("a.b.c");

      expect(model.get("a")).toEqual({ d: 2 });

      const operations = await save(model);

      expect(operations.$unset).toEqual({ "a.b": 1 });
    });

    it("keeps the parent when siblings remain", async () => {
      const model = persisted({ nested: { x: 1, y: 2 } });

      model.unset("nested.x");

      expect(model.get("nested")).toEqual({ y: 2 });

      const operations = await save(model);

      expect(operations.$unset).toEqual({ "nested.x": 1 });
    });

    it("leaves an object the user stored as {} alone", async () => {
      const model = persisted({ nested: {} });

      model.unset("nested.x");

      expect(model.get("nested")).toEqual({});
      expect(model.dirtyTracker.hasChanges()).toBe(false);
    });

    it("keeps {} when the user explicitly emptied it with set()", async () => {
      const model = persisted({ nested: { a: 1 } });

      model.set("nested", {});
      model.unset("nested.zzz");

      expect(model.get("nested")).toEqual({});

      const operations = await save(model);

      expect(operations.$set.nested).toEqual({});
    });

    it("removes a whole nested object with unset(field)", async () => {
      const model = persisted({ nested: { a: 1, b: { c: 2 } } });

      model.unset("nested");

      const operations = await save(model);

      expect(operations.$unset).toEqual({ nested: 1 });
      expect(operations.$set ?? {}).not.toHaveProperty("nested");
    });

    it("unsets a stored empty object with unset(field)", async () => {
      const model = persisted({ nested: {} });

      model.unset("nested");

      const operations = await save(model);

      expect(operations.$unset).toEqual({ nested: 1 });
    });

    it("never prunes arrays", () => {
      const model = persisted({ list: { items: ["a"] } });

      model.unset("list.items.0");

      expect(model.has("list")).toBe(true);
    });
  });

  describe("SQL tracker", () => {
    it("already reports a replaced JSON column as one whole column", () => {
      const tracker = new SqlDatabaseDirtyTracker({ id: 1, nested: { a: 1, b: 2 } });

      tracker.setAtPath("nested", { a: 1 });

      expect(tracker.getDirtyColumns()).toEqual(["nested"]);
      expect(tracker.getReplacedColumns()).toEqual(["nested"]);
      expect(tracker.getRemovedPaths()).toEqual([]);
    });
  });
});
