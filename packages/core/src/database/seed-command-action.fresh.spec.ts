import { describe, expect, it, vi } from "vitest";
import { clearAllTables } from "./seed-command-action";

describe("seed --fresh", () => {
  it("does not truncate the migrations table", async () => {
    const truncateTable = vi.fn();
    const datasource: any = {
      migrations: undefined,
      driver: {
        blueprint: { listTables: async () => ["users", "_migrations", "posts"] },
        truncateTable,
      },
    };

    await clearAllTables(datasource);

    expect(truncateTable.mock.calls.map((call) => call[0])).toEqual(["users", "posts"]);
  });

  it("honours a configured migrations table name", async () => {
    const truncateTable = vi.fn();
    const datasource: any = {
      migrations: { table: "schema_history" },
      driver: {
        blueprint: { listTables: async () => ["users", "schema_history", "_migrations"] },
        truncateTable,
      },
    };

    await clearAllTables(datasource);

    expect(truncateTable.mock.calls.map((call) => call[0])).toEqual(["users", "_migrations"]);
  });
});
