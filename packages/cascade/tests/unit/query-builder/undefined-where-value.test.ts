import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../src/drivers/postgres/postgres-query-builder";
import { UndefinedWhereValueError } from "../../../src/errors/undefined-where-value.error";
import type { QueryBuilderContract } from "../../../src/contracts/query-builder.contract";
import { createMockDriver } from "../../helpers/mock-driver";

/**
 * `where(column, undefined)` used to reach the driver unguarded — a bound
 * `undefined` silently binds as `= NULL`, a comparison that never matches
 * (SQL's three-valued logic) but never fails either, hiding call sites that
 * forgot to check for a missing id before querying (card 62e0e781:
 * `SELECT * FROM "users" WHERE "users"."id" = $1 LIMIT 1 [ undefined ]`).
 *
 * Both drivers share the base `QueryBuilder.where()`/`orWhere()` (Postgres)
 * or their own equivalent equality-position sanitization (MongoDB) — this
 * suite exercises both so the guard can't silently regress in either.
 */
describe("QueryBuilder — undefined where value", () => {
  const implementations: Array<{
    name: string;
    createBuilder: (table: string, ds: DataSource) => QueryBuilderContract;
    createMockDriver: () => unknown;
  }> = [
    {
      name: "MongoQueryBuilder",
      createBuilder: (table, ds) => new MongoQueryBuilder(table, ds),
      createMockDriver: () => createMockDriver("mongodb"),
    },
    {
      name: "PostgresQueryBuilder",
      createBuilder: (table, ds) => new PostgresQueryBuilder(table, ds),
      createMockDriver: () => {
        const driver = createMockDriver("postgres");
        (driver as any).dialect = new PostgresDialect();
        (driver as any).query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
        return driver;
      },
    },
  ];

  implementations.forEach(({ name, createBuilder, createMockDriver: createDriver }) => {
    describe(name, () => {
      let queryBuilder: QueryBuilderContract;
      let mockDataSource: DataSource;

      beforeEach(() => {
        const mockDriver = createDriver();
        mockDataSource = new DataSource({
          name: "test",
          driver: mockDriver as never,
          isDefault: true,
        });
        dataSourceRegistry.register(mockDataSource);
        queryBuilder = createBuilder("users", mockDataSource);
      });

      afterEach(() => {
        dataSourceRegistry.clear();
        vi.clearAllMocks();
      });

      it("throws UndefinedWhereValueError for where(field, undefined)", () => {
        expect(() => queryBuilder.where("id", undefined)).toThrow(UndefinedWhereValueError);
      });

      it("throws UndefinedWhereValueError for where(field, '=', undefined)", () => {
        expect(() => queryBuilder.where("id", "=", undefined)).toThrow(UndefinedWhereValueError);
      });

      it("throws UndefinedWhereValueError for where(field, '>', undefined)", () => {
        expect(() => queryBuilder.where("age", ">", undefined)).toThrow(UndefinedWhereValueError);
      });

      it("throws UndefinedWhereValueError for object-form where({ field: undefined })", () => {
        expect(() => queryBuilder.where({ id: undefined })).toThrow(UndefinedWhereValueError);
      });

      it("throws UndefinedWhereValueError for orWhere(field, undefined)", () => {
        expect(() => queryBuilder.orWhere("id", undefined)).toThrow(UndefinedWhereValueError);
      });

      it("names the offending field on the thrown error", () => {
        try {
          queryBuilder.where("id", undefined);
          expect.unreachable();
        } catch (error) {
          expect(error).toBeInstanceOf(UndefinedWhereValueError);
          expect((error as UndefinedWhereValueError).field).toBe("id");
        }
      });

      it("still allows null — the explicit way to match NULL", () => {
        expect(() => queryBuilder.where("deletedAt", null)).not.toThrow();
      });

      it("still allows a defined value", () => {
        expect(() => queryBuilder.where("id", 1)).not.toThrow();
      });
    });
  });
});
