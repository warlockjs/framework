import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../../src/drivers/mongodb/mongodb-query-builder";
import { createMockDriver } from "../../../helpers/mock-driver";

describe("MongoQueryBuilder — filter building (K1 B6, B10, B11)", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    const driver = createMockDriver("mongodb") as unknown as {
      database: { collection: (name: string) => unknown };
    };

    driver.database = { collection: (name: string) => ({ collectionName: name }) };

    dataSource = new DataSource({ name: "test", driver: driver as never, isDefault: true });
    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  const builder = () => new MongoQueryBuilder("users", dataSource);
  const filterOf = (q: MongoQueryBuilder) => (q as any).buildFilter();

  describe("B6: scopes apply with zero user conditions", () => {
    it("keeps the global scope in the filter of an unfiltered query", () => {
      const q = builder();
      (q as any).pendingGlobalScopes = new Map([
        ["tenant", { callback: (b: MongoQueryBuilder) => b.where("tenantId", 7), timing: "before" }],
      ]);

      expect(filterOf(q)).toEqual({ tenantId: 7 });
    });
  });

  describe("B10: typed where operators", () => {
    it.each([
      ["in", ["a", "b"], { role: { $in: ["a", "b"] } }],
      ["notIn", ["a"], { role: { $nin: ["a"] } }],
      ["between", [1, 5], { role: { $gte: 1, $lte: 5 } }],
      ["notBetween", [1, 5], { role: { $not: { $gte: 1, $lte: 5 } } }],
      ["<>", "banned", { role: { $ne: "banned" } }],
    ])("where(role, %s)", (op, value, expected) => {
      expect(filterOf(builder().where("role", op as any, value))).toEqual(expected);
    });

    it("compiles like / notLike", () => {
      const like = filterOf(builder().where("name", "like", "%x%")) as any;
      const notLike = filterOf(builder().where("name", "notLike", "%x%")) as any;

      expect(like.name.$regex).toBeDefined();
      expect(notLike.name.$not.$regex).toBe(like.name.$regex);
    });

    it("throws on an unknown operator instead of falling back to equality", () => {
      expect(() => filterOf(builder().where("a", "~~", 1))).toThrow(/Unsupported where operator/);
    });
  });

  describe("B11: colliding conditions are ANDed, not overwritten", () => {
    it("keeps both $expr conditions (whereMonth + whereYear)", () => {
      const filter = filterOf(builder().whereMonth("createdAt", 5).whereYear("createdAt", 2024));

      expect(filter.$expr).toBeDefined();
      expect(filter.$and).toHaveLength(1);
      expect(filter.$and[0].$expr).toBeDefined();
      expect(filter.$expr).not.toEqual(filter.$and[0].$expr);
    });

    it("keeps both $nor conditions (two whereNot)", () => {
      const filter = filterOf(
        builder()
          .whereNot((q: any) => q.where("a", 1))
          .whereNot((q: any) => q.where("b", 2)),
      );

      expect(filter.$nor).toEqual([{ a: 1 }]);
      expect(filter.$and).toEqual([{ $nor: [{ b: 2 }] }]);
    });

    it("keeps both bounds of a callback with age > 18 and age < 65", () => {
      const filter = filterOf(builder().where((q: any) => q.where("age", ">", 18).where("age", "<", 65)));

      expect(filter).toEqual({ age: { $gt: 18, $lt: 65 } });
    });

    it("keeps both same-operator conditions inside a callback", () => {
      const filter = filterOf(builder().where((q: any) => q.where("age", ">", 18).where("age", ">", 30)));

      expect(filter).toEqual({ age: { $gt: 18 }, $and: [{ age: { $gt: 30 } }] });
    });
  });
});
