import { describe, expect, it, vi } from "vitest";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { PostgresDriver } from "../../../../src/drivers/postgres/postgres-driver";
import { PostgresQueryParser } from "../../../../src/drivers/postgres/postgres-query-parser";

const where = (data: Record<string, unknown>, boolean = "and") => ({
  type: boolean === "or" ? "orWhere" : "where",
  data,
});

describe("postgres nested where groups", () => {
  it("emits two levels of parentheses with AND/OR joining", () => {
    const parser = new PostgresQueryParser({
      table: "users",
      dialect: new PostgresDialect(),
      operations: [
        where({ field: "x", operator: "=", value: 0 }),
        where(
          {
            nested: [
              where({ field: "a", operator: "=", value: 1 }),
              where(
                {
                  nested: [
                    where({ field: "b", operator: "=", value: 2 }),
                    where({ field: "c", operator: "=", value: 3 }, "or"),
                  ],
                },
                "or",
              ),
            ],
          },
          "and",
        ),
      ] as any,
    });
    const { query, bindings } = parser.parse();

    expect(query).toBe(
      `SELECT * FROM "users" WHERE "users"."x" = $1 AND ("users"."a" = $2 OR ("users"."b" = $3 OR "users"."c" = $4))`,
    );
    expect(bindings).toEqual([0, 1, 2, 3]);
  });
});

describe("postgres single-row update targeting", () => {
  const makeDriver = () => {
    const driver = new PostgresDriver({} as any);
    (driver as any).query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    return driver;
  };

  it("model update by id hits WHERE \"id\" = $n, never ctid", async () => {
    const driver = makeDriver();
    await driver.update("users", { id: 5 }, { $set: { name: "x" } });
    const [sql, params] = (driver as any).query.mock.calls[0];

    expect(sql).toContain('WHERE "id" = $2');
    expect(sql).not.toContain("ctid");
    expect(params).toEqual(["x", 5]);
  });

  it("no-PK filter keeps ctid but locks with SKIP LOCKED", async () => {
    const driver = makeDriver();
    await driver.update("users", { email: "a@b.c" }, { $set: { name: "x" } });
    const [sql] = (driver as any).query.mock.calls[0];

    expect(sql).toContain("ctid IN (SELECT ctid");
    expect(sql).toContain("LIMIT 1 FOR UPDATE SKIP LOCKED");
  });
});
