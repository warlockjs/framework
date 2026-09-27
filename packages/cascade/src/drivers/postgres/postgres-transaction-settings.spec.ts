import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const poolQuery = vi.fn();

class MockPool {
  public connect = connect;
  public query = poolQuery;

  public on(): void {}

  public end(): void {}
}

vi.mock("pg", () => ({
  default: { Pool: MockPool, types: { getTypeParser: () => (value: string) => value } },
  Pool: MockPool,
  types: { getTypeParser: () => (value: string) => value },
}));

const { PostgresDriver } = await import("./postgres-driver");

function makeClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
}

async function connectedDriver() {
  const driver = new PostgresDriver({ database: "test" });
  connect.mockResolvedValue(makeClient());
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await driver.connect();
  connect.mockReset();
  poolQuery.mockReset();

  return driver;
}

describe("PostgresDriver transaction-local settings", () => {
  beforeEach(() => {
    connect.mockReset();
    poolQuery.mockReset();
  });

  it("applies settings after BEGIN, before callback queries, with parameterized values", async () => {
    const driver = await connectedDriver();
    const client = makeClient();
    connect.mockResolvedValue(client);

    await driver.transaction(
      async () => {
        await driver.query("SELECT callback");
      },
      { settings: { "app.tenant_id": 42, statement_timeout: true } },
    );

    expect(client.query.mock.calls).toEqual([
      ["BEGIN"],
      ["SELECT set_config($1, $2, true)", ["app.tenant_id", "42"]],
      ["SELECT set_config($1, $2, true)", ["statement_timeout", "true"]],
      ["SELECT callback", []],
      ["COMMIT"],
    ]);
  });

  it("rejects an invalid setting name before acquiring a client", async () => {
    const driver = new PostgresDriver({ database: "test" });

    await expect(driver.beginTransaction({ settings: { "app.tenant-id": "acme" } })).rejects.toThrow(
      'Invalid PostgreSQL transaction setting name: "app.tenant-id"',
    );

    expect(connect).not.toHaveBeenCalled();
  });

  it("rolls back and releases when setting a transaction-local value fails", async () => {
    const driver = await connectedDriver();
    const client = makeClient();
    const settingError = new Error("setting failed");
    client.query.mockImplementation((sql: string) =>
      sql === "SELECT set_config($1, $2, true)"
        ? Promise.reject(settingError)
        : Promise.resolve({ rows: [], rowCount: 0 }),
    );
    connect.mockResolvedValue(client);

    await expect(
      driver.beginTransaction({ settings: { "app.tenant_id": "acme" } }),
    ).rejects.toBe(settingError);

    expect(client.query.mock.calls).toEqual([
      ["BEGIN"],
      ["SELECT set_config($1, $2, true)", ["app.tenant_id", "acme"]],
      ["ROLLBACK"],
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(settingError);
  });

  it("does not issue set_config when no settings are supplied", async () => {
    const driver = await connectedDriver();
    const client = makeClient();
    connect.mockResolvedValue(client);

    const tx = await driver.beginTransaction();
    await tx.rollback();

    expect(client.query.mock.calls).toEqual([["BEGIN"], ["ROLLBACK"]]);
  });
});
