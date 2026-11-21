import { describe, expect, it } from "vitest";
import { ColumnBuilder } from "./column-builder";

const migration = { addPendingIndex() {}, addForeignKeyOperation() {} };

const build = (name = "agency_type") => new ColumnBuilder(migration, name, "string");

describe("ColumnBuilder.default() with a bare word", () => {
  it("throws naming the column and defaultString()", () => {
    expect(() => build("kind").default("agency")).toThrow(/Column "kind".*defaultString\("agency"\)/s);
  });

  it.each(["CURRENT_TIMESTAMP", "current_date", "NULL", "true", "LOCALTIMESTAMP", "DEFAULT"])(
    "keeps the keyword %s raw",
    (keyword) => {
      expect(() => build().default(keyword)).not.toThrow();
    },
  );

  it.each(["NOW()", "gen_random_uuid()", "NOW() + INTERVAL '30 days'", "1.5", "-1"])(
    "keeps the expression %s raw",
    (expression) => {
      expect(() => build().default(expression)).not.toThrow();
    },
  );

  it("keeps numbers and booleans raw and defaultString() quoted", () => {
    expect(() => build().default(1)).not.toThrow();
    expect(() => build().default(false)).not.toThrow();
    expect(() => build().defaultString("agency")).not.toThrow();
  });
});
