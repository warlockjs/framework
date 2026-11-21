import { describe, expect, it } from "vitest";
import { ColumnBuilder } from "./column-builder";
import { rawDefaultSql } from "./raw-default";

const migration = { addPendingIndex() {}, addForeignKeyOperation() {} };

const build = (name = "agency_type") => new ColumnBuilder(migration, name, "string");

describe("rawDefaultSql() with a bare word", () => {
  it("throws naming the column and defaultString()", () => {
    expect(() => rawDefaultSql("kind", "agency")).toThrow(
      /Column "kind".*defaultString\("agency"\)/s,
    );
  });

  it.each([
    "CURRENT_TIMESTAMP",
    "current_timestamp",
    "Current_Timestamp",
    "current_date",
    "NULL",
    "true",
    "LOCALTIMESTAMP",
    "DEFAULT",
  ])("keeps the keyword %s raw", (keyword) => {
    expect(rawDefaultSql("kind", keyword)).toBe(keyword);
  });

  it.each([
    "NOW()",
    "gen_random_uuid()",
    "uuid_generate_v4()",
    "CURRENT_TIMESTAMP(6)",
    "NOW() + INTERVAL '30 days'",
    "1.5",
    "-1",
    "0",
  ])("keeps the expression %s raw", (expression) => {
    expect(rawDefaultSql("kind", expression)).toBe(expression);
  });

  it("keeps numbers raw", () => {
    expect(rawDefaultSql("kind", 1)).toBe("1");
  });
});

describe("ColumnBuilder.default()", () => {
  it("accepts a bare word: document databases ignore column defaults, the SQL drivers check it", () => {
    expect(build().default("active").getDefinition()).toMatchObject({
      defaultValue: "active",
      isRawDefault: true,
    });
  });

  it("keeps defaultString() quoted", () => {
    expect(build().defaultString("agency").getDefinition().isRawDefault).toBe(false);
  });
});
