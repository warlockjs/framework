import { describe, expect, it } from "vitest";
import { parseColumnDsl } from "./column-dsl-parser";

describe("parseColumnDsl", () => {
  it("accepts number as an alias of float", () => {
    expect(parseColumnDsl("price:number:nullable")[0]).toMatchObject({
      name: "price",
      helper: "float",
      modifiers: [".nullable()"],
    });
  });

  it("rejects unknown types and lists the valid ones", () => {
    expect(() => parseColumnDsl("price:money")).toThrow(/Unknown column type "money".*decimal/);
  });
});
