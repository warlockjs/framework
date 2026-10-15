import { describe, expect, it, vi } from "vitest";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";

const makeDriver = () => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  const driver = new PostgresDriver({ database: "x" } as never);

  (driver as unknown as { _pool: unknown })._pool = pool;

  return { driver, client, pool };
};

describe("PostgresDriver transaction context (K1 B7, B8)", () => {
  it("B7: a query inside transaction() that isn't handed the client uses the transaction client", async () => {
    const { driver, client, pool } = makeDriver();

    await driver.transaction(async () => {
      await driver.query("SELECT 1");
    });

    expect(client.query).toHaveBeenCalledWith("SELECT 1", []);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("B8: a query on driver B inside driver A's transaction does not use A's client", async () => {
    const a = makeDriver();
    const b = makeDriver();

    await a.driver.transaction(async () => {
      await b.driver.query("SELECT 2");
    });

    expect(a.client.query).not.toHaveBeenCalledWith("SELECT 2", []);
    expect(b.pool.query).toHaveBeenCalled();
  });
});
