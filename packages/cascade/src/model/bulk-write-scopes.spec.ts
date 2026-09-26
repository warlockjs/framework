import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { MongoQueryBuilder } from "../drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../drivers/postgres/postgres-query-builder";
import { Model } from "./model";

const tenantId = "tenant-7";

afterEach(() => {
  dataSourceRegistry.clear();
  vi.clearAllMocks();
});

function addLifecycleSpies(ModelClass: any) {
  const hooks = {
    updating: vi.fn(),
    updated: vi.fn(),
    deleting: vi.fn(),
    deleted: vi.fn(),
  };

  ModelClass.events().on("updating", hooks.updating);
  ModelClass.events().on("updated", hooks.updated);
  ModelClass.events().on("deleting", hooks.deleting);
  ModelClass.events().on("deleted", hooks.deleted);

  return hooks;
}

function addTenantScope(ModelClass: any) {
  ModelClass.addGlobalScope("tenant", (query) => query.where("tenantId", tenantId));
}

describe("Model bulk writes with global scopes", () => {
  it("postgres: Model.where().update() and delete() include the tenant scope but emit no model lifecycle events", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const driver = {
      name: "postgres",
      dialect: new PostgresDialect(),
      query,
      serialize: (fields: Record<string, unknown>) => fields,
      modelDefaults: {},
      on: vi.fn(),
    };
    const dataSource = new DataSource({ name: "postgres-bulk-scopes", driver: driver as any });

    class ScopedPostgresModel extends Model {
      public static override table = "bulk_scope_posts";
      public static override dataSource = dataSource;
      public static override builder = PostgresQueryBuilder as any;
    }

    addTenantScope(ScopedPostgresModel);
    const hooks = addLifecycleSpies(ScopedPostgresModel);

    await ScopedPostgresModel.where("status", "x").update({ title: "changed" });
    await ScopedPostgresModel.where("status", "x").delete();

    expect(query).toHaveBeenNthCalledWith(
      1,
      'UPDATE "bulk_scope_posts" SET "title" = $3 WHERE ("bulk_scope_posts"."tenantId" = $1) AND ("bulk_scope_posts"."status" = $2)',
      [tenantId, "x", "changed"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM "bulk_scope_posts" WHERE ("bulk_scope_posts"."tenantId" = $1) AND ("bulk_scope_posts"."status" = $2)',
      [tenantId, "x"],
    );

    // Current bulk-write behavior: it does not hydrate models, so instance/model lifecycle hooks do not fire.
    expect(hooks.updating).not.toHaveBeenCalled();
    expect(hooks.updated).not.toHaveBeenCalled();
    expect(hooks.deleting).not.toHaveBeenCalled();
    expect(hooks.deleted).not.toHaveBeenCalled();
  });

  it("mongodb: Model.where().update() and delete() include the tenant scope but emit no model lifecycle events", async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });
    const driver = {
      name: "mongodb",
      database: { collection: vi.fn(() => ({})) },
      updateMany,
      deleteMany,
      modelDefaults: {},
      on: vi.fn(),
    };
    const dataSource = new DataSource({ name: "mongodb-bulk-scopes", driver: driver as any });

    class ScopedMongoModel extends Model {
      public static override table = "bulk_scope_posts";
      public static override dataSource = dataSource;
      public static override builder = MongoQueryBuilder as any;
    }

    addTenantScope(ScopedMongoModel);
    const hooks = addLifecycleSpies(ScopedMongoModel);

    await ScopedMongoModel.where("status", "x").update({ title: "changed" });
    await ScopedMongoModel.where("status", "x").delete();

    expect(updateMany).toHaveBeenCalledWith(
      "bulk_scope_posts",
      { tenantId, status: "x" },
      { $set: { title: "changed" } },
    );
    expect(deleteMany).toHaveBeenCalledWith("bulk_scope_posts", { tenantId, status: "x" });

    // Current bulk-write behavior: it delegates to updateMany/deleteMany without lifecycle-event emission.
    expect(hooks.updating).not.toHaveBeenCalled();
    expect(hooks.updated).not.toHaveBeenCalled();
    expect(hooks.deleting).not.toHaveBeenCalled();
    expect(hooks.deleted).not.toHaveBeenCalled();
  });
});
