import { describe, expect, it, vi } from "vitest";
import { PostgresDriver } from "../../../../src/drivers/postgres/postgres-driver";

/**
 * Pure-logic tests for PostgreSQL value serialization (B1).
 *
 * `serialize()` carries no I/O, so these run without a database. They lock the
 * json/jsonb-aware encoding so a regression can't reintroduce the corruption
 * where node-pg renders object/string/empty arrays as a PostgreSQL array
 * literal `{...}` (and `[]` as `{}`) that a `json`/`jsonb` column rejects.
 *
 * The UPDATE `$set` path is exercised through the public `update()` method
 * with a stubbed `query()` so we can assert the bound params without a pool.
 */
describe("PostgresDriver serialize() — json/jsonb encoding (B1)", () => {
  const makeDriver = (nativeArrayColumns?: readonly string[]) =>
    new PostgresDriver({ database: "test", nativeArrayColumns });

  describe("arrays", () => {
    it("JSON-encodes an object-array into JSON text", () => {
      const driver = makeDriver();
      const result = driver.serialize({ tags: [{ id: 1 }, { id: 2 }] });

      expect(result.tags).toBe('[{"id":1},{"id":2}]');
      expect(typeof result.tags).toBe("string");
    });

    it("JSON-encodes a string-array into JSON text", () => {
      const driver = makeDriver();
      const result = driver.serialize({ labels: ["a", "b"] });

      expect(result.labels).toBe('["a","b"]');
    });

    it('encodes an empty array as "[]" and never "{}"', () => {
      const driver = makeDriver();
      const result = driver.serialize({ items: [] });

      expect(result.items).toBe("[]");
      expect(result.items).not.toBe("{}");
    });

    it("JSON-encodes a mixed-type array into JSON text", () => {
      const driver = makeDriver();
      const result = driver.serialize({ mixed: [1, "a", true] });

      expect(result.mixed).toBe('[1,"a",true]');
    });

    it("preserves an all-number array as the pgvector literal form", () => {
      const driver = makeDriver();
      const result = driver.serialize({ embedding: [0.1, 0.2, 0.3] });

      expect(result.embedding).toBe("[0.1,0.2,0.3]");
    });

    it("leaves a native-array column's raw array untouched (no JSONB[] regression)", () => {
      const driver = makeDriver(["history"]);
      const value = [{ at: 1 }, { at: 2 }];
      const result = driver.serialize({ history: value });

      // Native JSONB[] column: node-pg must receive the raw JS array so it
      // emits a '{...}' literal — so serialize() must NOT stringify it.
      expect(result.history).toBe(value);
      expect(Array.isArray(result.history)).toBe(true);
    });

    it("still vector-encodes an all-number native-array column (vector wins)", () => {
      // An all-number array is always the pgvector form regardless of the
      // native-array hint, since the vector branch is checked first.
      const driver = makeDriver(["embedding"]);
      const result = driver.serialize({ embedding: [1, 2, 3] });

      expect(result.embedding).toBe("[1,2,3]");
    });
  });

  describe("objects", () => {
    it("JSON-encodes a plain object into JSON text", () => {
      const driver = makeDriver();
      const result = driver.serialize({ meta: { a: 1, b: "x" } });

      expect(result.meta).toBe('{"a":1,"b":"x"}');
    });
  });

  describe("scalars and special types (unchanged)", () => {
    it("leaves a string scalar untouched", () => {
      const driver = makeDriver();
      const result = driver.serialize({ name: "Alice" });

      expect(result.name).toBe("Alice");
    });

    it("leaves number and boolean scalars untouched", () => {
      const driver = makeDriver();
      const result = driver.serialize({ age: 30, active: true });

      expect(result.age).toBe(30);
      expect(result.active).toBe(true);
    });

    it("converts Date to ISO string", () => {
      const driver = makeDriver();
      const date = new Date("2024-01-02T03:04:05.000Z");
      const result = driver.serialize({ createdAt: date });

      expect(result.createdAt).toBe("2024-01-02T03:04:05.000Z");
    });

    it("converts bigint to a decimal string", () => {
      const driver = makeDriver();
      const result = driver.serialize({ big: 9007199254740993n });

      expect(result.big).toBe("9007199254740993");
    });

    it("skips undefined values", () => {
      const driver = makeDriver();
      const result = driver.serialize({ a: 1, b: undefined });

      expect(result).toEqual({ a: 1 });
      expect("b" in result).toBe(false);
    });

    it("passes null through (binds as NULL)", () => {
      const driver = makeDriver();
      const result = driver.serialize({ deletedAt: null });

      expect(result.deletedAt).toBeNull();
    });
  });
});

describe("PostgresDriver UPDATE $set — json/jsonb encoding (B1)", () => {
  const makeDriver = (nativeArrayColumns?: readonly string[]) =>
    new PostgresDriver({ database: "test", nativeArrayColumns });

  /**
   * Stub query() so update() runs without a pool and we can read back the
   * params actually bound to the generated SQL.
   */
  const captureUpdateParams = async (
    driver: PostgresDriver,
    set: Record<string, unknown>,
  ): Promise<unknown[]> => {
    const querySpy = vi
      .spyOn(driver, "query")
      .mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await driver.update("users", { id: 1 }, { $set: set });

    const params = querySpy.mock.calls[0][1] as unknown[];
    querySpy.mockRestore();
    return params;
  };

  it("JSON-encodes an object-array $set value", async () => {
    const driver = makeDriver();
    const params = await captureUpdateParams(driver, { tags: [{ id: 1 }] });

    expect(params).toContain('[{"id":1}]');
  });

  it('encodes an empty-array $set value as "[]"', async () => {
    const driver = makeDriver();
    const params = await captureUpdateParams(driver, { items: [] });

    expect(params).toContain("[]");
    expect(params).not.toContain("{}");
  });

  it("JSON-encodes a plain-object $set value", async () => {
    const driver = makeDriver();
    const params = await captureUpdateParams(driver, { meta: { a: 1 } });

    expect(params).toContain('{"a":1}');
  });

  it("preserves an all-number $set array as the pgvector literal", async () => {
    const driver = makeDriver();
    const params = await captureUpdateParams(driver, { embedding: [1, 2, 3] });

    expect(params).toContain("[1,2,3]");
  });

  it("leaves a native-array column's $set array raw", async () => {
    const driver = makeDriver(["history"]);
    const value = [{ at: 1 }];
    const params = await captureUpdateParams(driver, { history: value });

    expect(params).toContain(value);
  });

  it("leaves scalar $set values untouched", async () => {
    const driver = makeDriver();
    const params = await captureUpdateParams(driver, { name: "Alice", age: 30 });

    expect(params).toContain("Alice");
    expect(params).toContain(30);
  });
});
