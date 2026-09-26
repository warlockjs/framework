import { beforeEach, describe, expect, it } from "vitest";
import type { QueryBuilderContract } from "../contracts";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../drivers/postgres/postgres-query-builder";
import { Model } from "./model";

class RawModel extends Model<{ age: number }> {
  public static table = "raw_models";
}

describe("Model.whereRaw", () => {
  beforeEach(() => {
    dataSourceRegistry.clear();

    const driver = { dialect: new PostgresDialect(), on: () => undefined } as Record<string, unknown>;
    const dataSource = new DataSource({ name: "where-raw", driver: driver as never, isDefault: true });
    driver.queryBuilder = (table: string) => new PostgresQueryBuilder(table, dataSource);
    dataSourceRegistry.register(dataSource);
  });

  it("matches Model.query().whereRaw() and retains the query builder type", () => {
    const bindings = [18];
    const query: QueryBuilderContract<RawModel> = RawModel.whereRaw("age > ?", bindings);
    const staticOperations = (query as typeof query & { operations: unknown[] }).operations;
    const instanceOperations = (
      RawModel.query().whereRaw("age > ?", bindings) as typeof query & { operations: unknown[] }
    ).operations;

    expect(staticOperations).toEqual(instanceOperations);
  });
});
