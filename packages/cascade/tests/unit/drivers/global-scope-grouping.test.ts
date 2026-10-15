import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../src/drivers/postgres/postgres-query-builder";
import { deleteRecords } from "../../../src/model/methods/delete-methods";
import { createMockDriver } from "../../helpers/mock-driver";

const tenantScope = new Map([
  [
    "tenant",
    {
      timing: "before",
      callback: (q: any) => q.where("tenantId", 7),
    },
  ],
]);

describe("global scopes are grouped away from user conditions", () => {
  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  it("pg: where(a).orWhere(b) becomes (scope) AND (a OR b)", async () => {
    const driver = createMockDriver("postgres");
    (driver as any).dialect = new PostgresDialect();
    (driver as any).query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const dataSource = new DataSource({ name: "t", driver, isDefault: true });
    dataSourceRegistry.register(dataSource);

    const qb = new PostgresQueryBuilder("users", dataSource);
    (qb as any).pendingGlobalScopes = tenantScope;
    await qb.where("a", 1).orWhere("b", 2).delete();

    const [sql, params] = (driver as any).query.mock.calls[0];
    expect(sql).toMatch(/WHERE \(.*"tenantId" = \$1\) AND \(.*"a" = \$2 OR .*"b" = \$3\)/);
    expect(params).toEqual([7, 1, 2]);
  });

  it("mongo: where(a).orWhere(b) becomes {scope, $or:[a,b]}", async () => {
    const driver = createMockDriver("mongodb");
    (driver as any).database = { collection: () => ({}) };
    const dataSource = new DataSource({ name: "t", driver, isDefault: true });
    dataSourceRegistry.register(dataSource);

    const qb = new MongoQueryBuilder("users", dataSource);
    (qb as any).pendingGlobalScopes = tenantScope;
    const filter = (qb.where("a", 1).orWhere("b", 2) as any).buildFilter();

    expect(filter).toEqual({ tenantId: 7, $or: [{ a: 1 }, { b: 2 }] });
  });
});

describe("Model.delete() static", () => {
  const makeModel = () => {
    const where = vi.fn().mockReturnThis();
    const remove = vi.fn().mockResolvedValue(3);
    const Model: any = { name: "User", query: () => ({ where, delete: remove }) };
    return { Model, where, remove };
  };

  it("throws when called without a filter", async () => {
    const { Model, remove } = makeModel();
    await expect(deleteRecords(Model)).rejects.toThrow(/requires a filter/);
    await expect(deleteRecords(Model, {})).rejects.toThrow(/requires a filter/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("with a filter, goes through the scoped query builder", async () => {
    const { Model, where, remove } = makeModel();
    await expect(deleteRecords(Model, { status: "old" })).resolves.toBe(3);
    expect(where).toHaveBeenCalledWith({ status: "old" });
    expect(remove).toHaveBeenCalled();
  });
});
