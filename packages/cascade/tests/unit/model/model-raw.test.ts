import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawQueryResult } from "../../../src/contracts";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import { RegisterModel } from "../../../src/model/register-model";
import { createMockDriver } from "../../utils/test-helpers";

@RegisterModel()
class RawUser extends Model {
  static table = "raw_users";
}

/**
 * Tests for the typed, transaction-aware raw query surface (S1):
 * - `Model.raw<T>()` delegates to `getDriver().query`.
 * - `DataSource.raw<T>()` is a thin passthrough to `driver.query`.
 * - The return type carries `rows: T[]` + `rowCount`.
 */
describe("raw query surface (S1)", () => {
  let queryMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const driver = createMockDriver();
    queryMock = vi
      .fn()
      .mockResolvedValue({ rows: [{ id: 1, total: 5 }], rowCount: 1 });
    // The mock driver helper omits query(); attach it for the raw surface.
    (driver as unknown as { query: typeof queryMock }).query = queryMock;

    dataSourceRegistry.register({ name: "test", driver, isDefault: true });
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.restoreAllMocks();
  });

  describe("Model.raw()", () => {
    it("delegates to getDriver().query with sql + params", async () => {
      const sql = "SELECT id, COUNT(*) AS total FROM orders WHERE user_id = $1 GROUP BY id";
      const params = [42];

      const result = await RawUser.raw(sql, params);

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(sql, params);
      expect(result.rows).toEqual([{ id: 1, total: 5 }]);
      expect(result.rowCount).toBe(1);
    });

    it("passes through when params are omitted", async () => {
      await RawUser.raw("SELECT 1");

      expect(queryMock).toHaveBeenCalledWith("SELECT 1", undefined);
    });

    it("returns a typed RawQueryResult<T>", async () => {
      type Row = { id: number; total: number };
      queryMock.mockResolvedValueOnce({ rows: [{ id: 7, total: 99 }], rowCount: 1 });

      const result: RawQueryResult<Row> = await RawUser.raw<Row>(
        "SELECT id, total FROM orders",
      );

      // Compile-time: result.rows is Row[]. Runtime: shape is preserved.
      const first: Row = result.rows[0];
      expect(first.id).toBe(7);
      expect(first.total).toBe(99);
      expect(result.rowCount).toBe(1);
    });
  });

  describe("DataSource.raw()", () => {
    it("delegates to the driver's query", async () => {
      const driver = createMockDriver();
      const dsQuery = vi.fn().mockResolvedValue({ rows: [{ n: 3 }], rowCount: 1 });
      (driver as unknown as { query: typeof dsQuery }).query = dsQuery;

      const dataSource = new DataSource({ name: "ds", driver });

      const result = await dataSource.raw<{ n: number }>("SELECT COUNT(*) AS n FROM users", []);

      expect(dsQuery).toHaveBeenCalledWith("SELECT COUNT(*) AS n FROM users", []);
      expect(result.rows[0].n).toBe(3);
    });
  });
});
