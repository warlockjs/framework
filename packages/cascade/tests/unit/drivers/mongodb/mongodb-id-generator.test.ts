import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoIdGenerator } from "../../../../src/drivers/mongodb/mongodb-id-generator";
import type { MongoDbDriver } from "../../../../src/drivers/mongodb/mongodb-driver";

/**
 * Unit coverage for the MongoDB id generator's atomic reservation.
 *
 * MongoDB's aggregation pipeline can't run in a unit test, so the fake counter
 * EVALUATES the very pipeline the generator emits (reading the `$cond` `then`
 * and the `$add` operand the code built). That means a wrong cold-start anchor
 * (`count` vs `count - 1`) or a wrong steady-state stride surfaces directly in
 * the returned ids — the math is tested at its source, not just asserted as a
 * literal.
 */

type Counter = {
  docs: Map<string, number>;
  findOneAndUpdate: ReturnType<typeof vi.fn>;
  createIndex: ReturnType<typeof vi.fn>;
};

function createFakeCounter(): Counter {
  const docs = new Map<string, number>();

  const findOneAndUpdate = vi.fn(
    async (
      filter: { collection: string },
      pipeline: Array<{ $set: { id: { $cond: { then: number; else: { $add: [string, number] } } } } }>,
      _options: unknown,
    ) => {
      const key = filter.collection;
      const cond = pipeline[0].$set.id.$cond;
      const coldStartValue = cond.then; // initialId + (count - 1) * incrementIdBy
      const steadyAdd = cond.else.$add[1]; // count * incrementIdBy

      const existing = docs.get(key);
      const newId = existing === undefined ? coldStartValue : existing + steadyAdd;

      docs.set(key, newId);

      return { collection: key, id: newId };
    },
  );

  const createIndex = vi.fn(async () => undefined);

  return { docs, findOneAndUpdate, createIndex };
}

function createFakeDriver(counter: Counter): MongoDbDriver {
  const collection = {
    findOneAndUpdate: counter.findOneAndUpdate,
    createIndex: counter.createIndex,
  };

  return {
    getDatabase: () => ({ collection: () => collection }),
  } as unknown as MongoDbDriver;
}

describe("MongoIdGenerator", () => {
  let counter: Counter;
  let generator: MongoIdGenerator;

  beforeEach(() => {
    counter = createFakeCounter();
    generator = new MongoIdGenerator(createFakeDriver(counter));
  });

  describe("generateNextId (single)", () => {
    it("issues initialId first, then increments", async () => {
      expect(await generator.generateNextId({ table: "users" })).toBe(1);
      expect(await generator.generateNextId({ table: "users" })).toBe(2);
      expect(await generator.generateNextId({ table: "users" })).toBe(3);
    });

    it("honors initialId on the first id", async () => {
      expect(await generator.generateNextId({ table: "users", initialId: 1000 })).toBe(1000);
      expect(await generator.generateNextId({ table: "users", initialId: 1000 })).toBe(1001);
    });

    it("honors incrementIdBy (first id is still initialId)", async () => {
      expect(await generator.generateNextId({ table: "users", incrementIdBy: 5 })).toBe(1);
      expect(await generator.generateNextId({ table: "users", incrementIdBy: 5 })).toBe(6);
      expect(await generator.generateNextId({ table: "users", incrementIdBy: 5 })).toBe(11);
    });
  });

  describe("generateNextIds (block)", () => {
    it("reserves a contiguous block whose FIRST id equals initialId (cold start)", async () => {
      const ids = await generator.generateNextIds({ table: "users", count: 3 });
      expect(ids).toEqual([1, 2, 3]);
    });

    it("continues from the stored counter on the next block (no overlap)", async () => {
      expect(await generator.generateNextIds({ table: "users", count: 3 })).toEqual([1, 2, 3]);
      expect(await generator.generateNextIds({ table: "users", count: 2 })).toEqual([4, 5]);
    });

    it("honors initialId so the first block starts exactly at initialId", async () => {
      const ids = await generator.generateNextIds({ table: "users", count: 5, initialId: 100 });
      expect(ids).toEqual([100, 101, 102, 103, 104]);
    });

    it("honors incrementIdBy across the block and across blocks", async () => {
      expect(
        await generator.generateNextIds({ table: "users", count: 3, incrementIdBy: 10 }),
      ).toEqual([1, 11, 21]);
      expect(
        await generator.generateNextIds({ table: "users", count: 2, incrementIdBy: 10 }),
      ).toEqual([31, 41]);
    });

    it("count = 1 matches single-id behavior", async () => {
      expect(await generator.generateNextIds({ table: "users", count: 1 })).toEqual([1]);
      expect(await generator.generateNextId({ table: "users" })).toBe(2);
    });

    it("returns an empty array for a non-positive count without touching the counter", async () => {
      expect(await generator.generateNextIds({ table: "users", count: 0 })).toEqual([]);
      expect(counter.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("leaves the stored counter equal to the block's last id (goal 2, no setLastId)", async () => {
      await generator.generateNextIds({ table: "users", count: 4, initialId: 10, incrementIdBy: 2 });
      // first block: 10,12,14,16 -> stored last id is 16
      expect(counter.docs.get("users")).toBe(16);
    });
  });

  describe("unique index", () => {
    it("ensures the unique index once, before reserving", async () => {
      await generator.generateNextId({ table: "users" });
      await generator.generateNextIds({ table: "users", count: 2 });

      expect(counter.createIndex).toHaveBeenCalledTimes(1);
      expect(counter.createIndex).toHaveBeenCalledWith(
        { collection: 1 },
        expect.objectContaining({ unique: true }),
      );
    });
  });

  describe("cold-start predicate", () => {
    it("tests counter existence ($type), not truthiness, so a stored 0 is never re-issued", async () => {
      await generator.generateNextId({ table: "zeros", initialId: 0 });

      const cond = (counter.findOneAndUpdate.mock.calls[0][1] as Array<Record<string, unknown>>)[0]
        .$set as { id: { $cond: { if: unknown } } };
      const predicate = JSON.stringify(cond.id.$cond.if);

      expect(predicate).toContain("$type"); // existence-based
      expect(predicate).not.toContain("$not"); // not truthiness-based
    });

    it("issues a stored 0 once then increments (initialId: 0)", async () => {
      expect(await generator.generateNextId({ table: "zeros", initialId: 0 })).toBe(0);
      expect(await generator.generateNextId({ table: "zeros", initialId: 0 })).toBe(1);
      expect(await generator.generateNextId({ table: "zeros", initialId: 0 })).toBe(2);
    });
  });

  describe("duplicate-key (E11000) retry", () => {
    it("retries the reservation when the cold-start upsert races", async () => {
      let attempts = 0;
      counter.findOneAndUpdate.mockImplementationOnce(async () => {
        attempts++;
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      });

      const id = await generator.generateNextId({ table: "races" });

      expect(attempts).toBe(1);
      // first call threw, retry succeeded -> two calls total
      expect(counter.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(id).toBe(1);
    });

    it("rethrows a non-duplicate-key error without retrying", async () => {
      counter.findOneAndUpdate.mockImplementationOnce(async () => {
        throw Object.assign(new Error("network blip"), { code: 89 });
      });

      await expect(generator.generateNextId({ table: "boom" })).rejects.toThrow("network blip");
      expect(counter.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
