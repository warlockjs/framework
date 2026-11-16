import { describe, expect, it, vi } from "vitest";

const fields = [
  { name: "id", dataTypeID: 20 },
  { name: "created_at", dataTypeID: 1114 },
];

vi.mock("pg", () => {
  class Pool {
    public on(): void {}

    public async connect(): Promise<{ release(): void }> {
      return { release() {} };
    }

    public async query(): Promise<unknown> {
      return {
        rows: [
          { id: "1", created_at: "2024-05-01T10:00:00.000Z" },
          { id: "2", created_at: "2024-05-02T10:00:00.000Z" },
        ],
        rowCount: 2,
        fields,
        command: "SELECT",
      };
    }
  }

  return { Pool, types: { getTypeParser: () => (value: string) => value } };
});

import { PostgresDriver } from "./postgres-driver";

describe("Postgres column types per result", () => {
  it("converts rows through the per-row types by default", async () => {
    const driver = new PostgresDriver({ database: "test" });
    await driver.connect();

    const result = await driver.query("select 1");
    const row = driver.deserialize(result.rows[0] as Record<string, unknown>);

    expect(row.id).toBe(1);
    expect(row.createdAt ?? row.created_at).toBeInstanceOf(Date);
  });

  it("converts a deferred result through withColumnTypes, once for all rows", async () => {
    const driver = new PostgresDriver({ database: "test" });
    await driver.connect();

    const result = await driver.query("select 1", [], { deferColumnTypes: true });

    // Outside the scope nothing is known about the rows: they stay as pg returned them.
    expect(driver.deserialize({ ...(result.rows[0] as object) }).id).toBe("1");

    const rows = driver.withColumnTypes(result, () =>
      result.rows.map((row) => driver.deserialize(row as Record<string, unknown>)),
    );

    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(rows[0]?.createdAt ?? rows[0]?.created_at).toBeInstanceOf(Date);

    // The scope is closed again afterwards.
    expect(driver.deserialize({ id: "3" }).id).toBe("3");
  });
});
