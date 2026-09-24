import { describe, expect, it } from "vitest";
import { DatabaseLogModel } from "./database-log";

/**
 * Build a model over raw row data without a registered data source
 */
function rowOf(data: Record<string, unknown>): DatabaseLogModel {
  const row = Object.create(DatabaseLogModel.prototype) as DatabaseLogModel;

  row.data = data as never;

  return row;
}

describe("DatabaseLogModel legacy compat", () => {
  it("reads a legacy row through content/stack", () => {
    const row = rowOf({ message: "boom", trace: "at x" });

    expect(row.content).toBe("boom");
    expect(row.stack).toBe("at x");
  });

  it("prefers new fields when present", () => {
    const row = rowOf({ content: "new", message: "old" });

    expect(row.get("content")).toBe("new");
  });
});
