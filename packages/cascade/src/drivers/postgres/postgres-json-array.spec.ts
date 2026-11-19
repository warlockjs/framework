import { describe, expect, it } from "vitest";
import { PostgresDriver } from "./postgres-driver";

describe("PostgresDriver.serialize — arrays bound to json columns", () => {
  const driver = new PostgresDriver({ database: "test" });

  it("binds a string array as JSON text", () => {
    expect(driver.serialize({ tags: ["hot", "drink"] }, "products")).toEqual({
      tags: '["hot","drink"]',
    });
  });

  it("binds an empty array, a mixed array and an object array as JSON text", () => {
    expect(driver.serialize({ a: [], b: ["x", 1, null], c: [{ k: "v" }] }, "products")).toEqual({
      a: "[]",
      b: '["x",1,null]',
      c: '[{"k":"v"}]',
    });
  });

  it("binds a string array as JSON text even when the table is unknown", () => {
    expect(driver.serialize({ tags: ["a"] })).toEqual({ tags: '["a"]' });
  });
});
