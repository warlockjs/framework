import { describe, expect, it } from "vitest";
import { parseColumnDsl } from "../../../src/cli/commands/generate/generators/column-dsl-parser";

/**
 * Unit coverage for the migration column DSL parser. Input is a compact
 * `name:type:modifier,...` string; output is `{ name, helper, modifiers }`
 * where the type is mapped to a Cascade column-builder helper and each extra
 * segment becomes a `.modifier()` call string.
 */
describe("parseColumnDsl", () => {
  it("returns an empty array for empty input", () => {
    expect(parseColumnDsl("")).toEqual([]);
  });

  it("parses a single column with name and type", () => {
    expect(parseColumnDsl("phone:text")).toEqual([
      { name: "phone", helper: "text", modifiers: [] },
    ]);
  });

  it("defaults the type to string when omitted", () => {
    expect(parseColumnDsl("title")).toEqual([{ name: "title", helper: "string", modifiers: [] }]);
  });

  it("maps type aliases to their builder helpers", () => {
    expect(parseColumnDsl("flag:bool")[0].helper).toBe("boolCol");
    expect(parseColumnDsl("count:int")[0].helper).toBe("integer");
    expect(parseColumnDsl("big:bigInt")[0].helper).toBe("bigInteger");
    expect(parseColumnDsl("data:object")[0].helper).toBe("objectCol");
    expect(parseColumnDsl("kind:enum")[0].helper).toBe("enumCol");
    expect(parseColumnDsl("tags:set")[0].helper).toBe("setCol");
    expect(parseColumnDsl("file:binary")[0].helper).toBe("blobCol");
  });

  it("falls back to the raw type when it is unmapped", () => {
    expect(parseColumnDsl("loc:point")[0].helper).toBe("point");
  });

  it("renders trailing segments as modifier call strings", () => {
    expect(parseColumnDsl("price:decimal:notNullable:unsigned")).toEqual([
      {
        name: "price",
        helper: "decimal",
        modifiers: [".notNullable()", ".unsigned()"],
      },
    ]);
  });

  it("parses multiple comma-separated columns", () => {
    const columns = parseColumnDsl("phone:text:nullable,price:decimal:unsigned");

    expect(columns).toHaveLength(2);
    expect(columns[0]).toEqual({ name: "phone", helper: "text", modifiers: [".nullable()"] });
    expect(columns[1]).toEqual({ name: "price", helper: "decimal", modifiers: [".unsigned()"] });
  });

  it("trims whitespace and skips empty entries", () => {
    const columns = parseColumnDsl(" name:string , , age:int ");

    expect(columns.map((column) => column.name)).toEqual(["name", "age"]);
  });
});
