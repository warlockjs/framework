import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverContract, InsertResult } from "../../../src/contracts/database-driver.contract";
import type { DataSource } from "../../../src/data-source/data-source";
import { Model } from "../../../src/model/model";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

// Model under test: timestamps enabled, ids supplied by the caller (no
// auto-generation) so assertions stay deterministic.
class BulkUser extends Model {
  static table = "bulk_users";
  static primaryKey = "id";
  static autoGenerateId = false;
  static createdAtColumn: string | false = "createdAt";
  static updatedAtColumn: string | false = "updatedAt";
}

describe("Model.createMany", () => {
  let mockDriver: DriverContract;
  let mockDataSource: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDriver = createMockDriver();
    mockDataSource = createMockDataSource({ driver: mockDriver });
    vi.spyOn(BulkUser, "getDataSource").mockReturnValue(mockDataSource);
  });

  describe("empty input", () => {
    it("returns an empty array without touching the driver (default path)", async () => {
      const result = await BulkUser.createMany([]);

      expect(result).toEqual([]);
      expect(mockDriver.insert).not.toHaveBeenCalled();
      expect(mockDriver.insertMany).not.toHaveBeenCalled();
    });

    it("returns an empty array without touching the driver (bulk path)", async () => {
      const result = await BulkUser.createMany([], { bulk: true });

      expect(result).toEqual([]);
      expect(mockDriver.insert).not.toHaveBeenCalled();
      expect(mockDriver.insertMany).not.toHaveBeenCalled();
    });
  });

  describe("default path (per-row save)", () => {
    it("creates one record per row via the single-row insert", async () => {
      const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }];

      const models = await BulkUser.createMany(rows);

      expect(models).toHaveLength(3);
      expect(mockDriver.insert).toHaveBeenCalledTimes(3);
      expect(mockDriver.insertMany).not.toHaveBeenCalled();
      expect(models.map((model) => model.get("name"))).toEqual(["Alice", "Bob", "Carol"]);
    });

    it("preserves per-row prep: stamps timestamps on each row", async () => {
      await BulkUser.createMany([{ name: "Alice" }]);

      expect(mockDriver.insert).toHaveBeenCalledWith(
        "bulk_users",
        expect.objectContaining({
          name: "Alice",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      );
    });

    it("returns models that are no longer new", async () => {
      const [model] = await BulkUser.createMany([{ name: "Alice" }]);

      expect(model.isNew).toBe(false);
    });

    it("honors batchSize: still one insert per row but chunked sequentially", async () => {
      const order: string[] = [];

      (mockDriver.insert as ReturnType<typeof vi.fn>).mockImplementation(
        async (_table: string, document: Record<string, unknown>) => {
          order.push(document.name as string);
          return { document };
        },
      );

      const rows = [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }];

      const models = await BulkUser.createMany(rows, { batchSize: 2 });

      expect(models).toHaveLength(5);
      expect(mockDriver.insert).toHaveBeenCalledTimes(5);
      // Chunks run sequentially in input order: [a,b] then [c,d] then [e].
      expect(order).toEqual(["a", "b", "c", "d", "e"]);
    });
  });

  describe("bulk path (driver.insertMany)", () => {
    beforeEach(() => {
      // The bulk path flushes prepared documents through insertMany; return one
      // InsertResult per submitted document so the merge-back step has data.
      (mockDriver.insertMany as ReturnType<typeof vi.fn>).mockImplementation(
        async (_table: string, documents: Record<string, unknown>[]): Promise<InsertResult[]> => {
          return documents.map((document, index) => ({
            document: { ...document, _id: `mongo_${index}` },
          }));
        },
      );
    });

    it("routes a single chunk through one insertMany call with multi-row values", async () => {
      const rows = [{ name: "Alice" }, { name: "Bob" }];

      const models = await BulkUser.createMany(rows, { bulk: true });

      expect(mockDriver.insertMany).toHaveBeenCalledTimes(1);
      expect(mockDriver.insert).not.toHaveBeenCalled();

      const [, submittedDocuments] = (mockDriver.insertMany as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(submittedDocuments).toHaveLength(2);
      expect(models).toHaveLength(2);
      expect(models.map((model) => model.get("name"))).toEqual(["Alice", "Bob"]);
    });

    it("applies the writer prep (timestamps) to every bulk document", async () => {
      await BulkUser.createMany([{ name: "Alice" }, { name: "Bob" }], { bulk: true });

      const [table, submittedDocuments] = (mockDriver.insertMany as ReturnType<typeof vi.fn>).mock
        .calls[0];

      expect(table).toBe("bulk_users");
      for (const document of submittedDocuments as Record<string, unknown>[]) {
        expect(document.createdAt).toBeInstanceOf(Date);
        expect(document.updatedAt).toBeInstanceOf(Date);
      }
    });

    it("merges driver-returned values back onto the returned models", async () => {
      const [alice, bob] = await BulkUser.createMany(
        [{ name: "Alice" }, { name: "Bob" }],
        { bulk: true },
      );

      expect(alice.get("_id")).toBe("mongo_0");
      expect(bob.get("_id")).toBe("mongo_1");
      expect(alice.isNew).toBe(false);
      expect(bob.isNew).toBe(false);
    });

    it("honors batchSize: one insertMany call per chunk", async () => {
      const rows = Array.from({ length: 5 }, (_, index) => ({ name: `user_${index}` }));

      const models = await BulkUser.createMany(rows, { bulk: true, batchSize: 2 });

      // 5 rows / batchSize 2 => chunks of [2, 2, 1] => 3 insertMany calls.
      expect(mockDriver.insertMany).toHaveBeenCalledTimes(3);
      expect(mockDriver.insert).not.toHaveBeenCalled();
      expect(models).toHaveLength(5);

      const calls = (mockDriver.insertMany as ReturnType<typeof vi.fn>).mock.calls;
      expect((calls[0][1] as unknown[]).length).toBe(2);
      expect((calls[1][1] as unknown[]).length).toBe(2);
      expect((calls[2][1] as unknown[]).length).toBe(1);
    });

    it("does not skip events on the default path while the bulk path does", async () => {
      // Sanity guard: the default path keeps the single-row insert wired even
      // after a bulk run restored the original insert function.
      await BulkUser.createMany([{ name: "Alice" }], { bulk: true });
      await BulkUser.createMany([{ name: "Bob" }]);

      expect(mockDriver.insert).toHaveBeenCalledTimes(1);
      expect(mockDriver.insertMany).toHaveBeenCalledTimes(1);
    });

    it("tolerates a driver that returns raw rows (no { document } wrapper)", async () => {
      (mockDriver.insertMany as ReturnType<typeof vi.fn>).mockImplementation(
        async (_table: string, documents: Record<string, unknown>[]) => {
          // Postgres-style: returns RETURNING * rows directly, not { document }.
          return documents.map((document, index) => ({ ...document, id: index + 100 }));
        },
      );

      const [alice, bob] = await BulkUser.createMany(
        [{ name: "Alice" }, { name: "Bob" }],
        { bulk: true },
      );

      expect(alice.get("id")).toBe(100);
      expect(bob.get("id")).toBe(101);
    });
  });

  describe("id block reservation (auto-generated ids)", () => {
    class AutoUser extends Model {
      static table = "auto_users";
      static primaryKey = "id";
      static autoGenerateId = true;
      static createdAtColumn: string | false = false;
      static updatedAtColumn: string | false = false;
    }

    let blockDriver: DriverContract;
    let generateNextIds: ReturnType<typeof vi.fn>;
    let generateNextId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      let next = 1;
      generateNextIds = vi.fn(async ({ count }: { count: number }) => {
        const ids = Array.from({ length: count }, (_, index) => next + index);
        next += count;
        return ids;
      });
      generateNextId = vi.fn(async () => next++);

      blockDriver = createMockDriver();
      // Echo the submitted document so the pre-seeded id survives the merge-back
      // (the real Mongo driver returns only _id, not a canned numeric id).
      (blockDriver.insert as ReturnType<typeof vi.fn>).mockImplementation(
        async (_table: string, document: Record<string, unknown>): Promise<InsertResult> => ({
          document,
        }),
      );
      (blockDriver.insertMany as ReturnType<typeof vi.fn>).mockImplementation(
        async (_table: string, documents: Record<string, unknown>[]): Promise<InsertResult[]> =>
          documents.map((document) => ({ document })),
      );

      const dataSource = createMockDataSource({
        driver: blockDriver,
        idGenerator: { generateNextId, generateNextIds },
      });
      vi.spyOn(AutoUser, "getDataSource").mockReturnValue(dataSource);
    });

    it("default path: reserves ONE block per chunk and pre-seeds ids", async () => {
      const models = await AutoUser.createMany([{ name: "a" }, { name: "b" }, { name: "c" }]);

      expect(generateNextIds).toHaveBeenCalledTimes(1);
      expect(generateNextIds).toHaveBeenCalledWith(
        expect.objectContaining({ table: "auto_users", count: 3 }),
      );
      // pre-seeded ids mean the per-row writer never calls the single generator
      expect(generateNextId).not.toHaveBeenCalled();
      expect(models.map((model) => model.get("id"))).toEqual([1, 2, 3]);
    });

    it("bulk path: one block + one insertMany per chunk", async () => {
      const models = await AutoUser.createMany([{ name: "a" }, { name: "b" }], { bulk: true });

      expect(generateNextIds).toHaveBeenCalledTimes(1);
      expect(generateNextIds).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
      expect(blockDriver.insertMany).toHaveBeenCalledTimes(1);
      expect(models.map((model) => model.get("id"))).toEqual([1, 2]);
    });

    it("reserves one block per chunk under batchSize", async () => {
      await AutoUser.createMany([{ name: "a" }, { name: "b" }, { name: "c" }], { batchSize: 2 });

      // chunks [a,b],[c] -> two reservations of count 2 and 1
      expect(generateNextIds).toHaveBeenCalledTimes(2);
      expect((generateNextIds.mock.calls[0][0] as { count: number }).count).toBe(2);
      expect((generateNextIds.mock.calls[1][0] as { count: number }).count).toBe(1);
    });

    it("sizes the block to only id-less rows (respects caller-supplied ids)", async () => {
      const models = await AutoUser.createMany([{ name: "a", id: 999 }, { name: "b" }]);

      expect(generateNextIds).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
      expect(models.map((model) => model.get("id"))).toEqual([999, 1]);
    });

    it("falls back to per-row generation when no batch API is available", async () => {
      const dataSource = createMockDataSource({
        driver: blockDriver,
        idGenerator: { generateNextId },
      });
      vi.spyOn(AutoUser, "getDataSource").mockReturnValue(dataSource);

      await AutoUser.createMany([{ name: "a" }, { name: "b" }]);

      expect(generateNextId).toHaveBeenCalled();
    });

    it("throws loudly if the batch generator returns the wrong id count", async () => {
      generateNextIds.mockResolvedValueOnce([1]); // only 1 id for 2 id-less rows

      await expect(AutoUser.createMany([{ name: "a" }, { name: "b" }])).rejects.toThrow(
        /return exactly the requested count/,
      );
    });

    it("does not reserve a block for random-increment models", async () => {
      class RandomUser extends Model {
        static table = "random_users";
        static autoGenerateId = true;
        static randomIncrement: boolean | (() => number) = true;
        static createdAtColumn: string | false = false;
        static updatedAtColumn: string | false = false;
      }
      const dataSource = createMockDataSource({
        driver: blockDriver,
        idGenerator: { generateNextId, generateNextIds },
      });
      vi.spyOn(RandomUser, "getDataSource").mockReturnValue(dataSource);

      await RandomUser.createMany([{ name: "a" }, { name: "b" }]);

      expect(generateNextIds).not.toHaveBeenCalled();
    });
  });
});
