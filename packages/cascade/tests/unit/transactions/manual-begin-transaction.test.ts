import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { databaseTransactionContext } =
  await import("../../../src/context/database-transaction-context");
const { MongoDbDriver } = await import("../../../src/drivers/mongodb/mongodb-driver");
const { PostgresDriver } = await import("../../../src/drivers/postgres/postgres-driver");

/**
 * A manual `await driver.beginTransaction()` must bind the transaction to the
 * caller's own async flow: every query the caller runs afterwards uses the
 * session until commit/rollback, and never leaks into unrelated flows.
 *
 * Drivers are exercised with a faked client/pool (no live database).
 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

const makeMongoSession = (overrides: Record<string, unknown> = {}) => ({
  startTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  abortTransaction: vi.fn().mockResolvedValue(undefined),
  endSession: vi.fn().mockResolvedValue(undefined),
  withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
  ...overrides,
});

const makeMongo = (session: object) => {
  const driver = new MongoDbDriver({ database: "test", uri: "mongodb://localhost" });
  const internals = driver as unknown as Record<string, unknown>;

  internals.client = { startSession: () => session };
  internals.replicaSetChecked = true;

  return { driver, session, failBegin: () => failMongoBegin(driver) };
};

function failMongoBegin(driver: InstanceType<typeof MongoDbDriver>) {
  const internals = driver as unknown as Record<string, unknown>;

  internals.client = {
    startSession: () =>
      makeMongoSession({ startTransaction: vi.fn().mockRejectedValue(new Error("no")) }),
  };
}

const makePostgres = async () => {
  const driver = new PostgresDriver({ database: "test" });
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };

  connect.mockReset();
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  connect.mockResolvedValue(client);
  await driver.connect();

  // Each driver gets its own pool, so concurrent drivers hand out distinct clients.
  const pool = (driver as unknown as { pool: { connect: unknown } }).pool;
  const poolConnect = vi.fn().mockResolvedValue(client);

  pool.connect = poolConnect;

  return {
    driver,
    session: client,
    failBegin: () => poolConnect.mockRejectedValue(new Error("no")),
  };
};

const factories = {
  MongoDbDriver: async () => makeMongo(makeMongoSession()),
  PostgresDriver: makePostgres,
};

describe.each(Object.entries(factories))("%s manual beginTransaction()", (_name, make) => {
  beforeEach(() => databaseTransactionContext.clear());
  afterEach(() => databaseTransactionContext.clear());

  it("hands the session to the caller's queries after await beginTransaction()", async () => {
    const { driver, session } = await make();

    expect(databaseTransactionContext.getSession()).toBeUndefined();

    const tx = await driver.beginTransaction();

    expect(databaseTransactionContext.getSession()).toBe(session);
    await tick();
    expect(databaseTransactionContext.getSession()).toBe(session);

    await tx.rollback();
  });

  it.each(["commit", "rollback"] as const)("stops handing it out after %s", async (outcome) => {
    const { driver, session } = await make();
    const tx = await driver.beginTransaction();

    expect(databaseTransactionContext.getSession()).toBe(session);

    await tx[outcome]();

    expect(databaseTransactionContext.getSession()).toBeUndefined();
    expect(databaseTransactionContext.hasActiveTransaction()).toBe(false);
    await tick();
    expect(databaseTransactionContext.getSession()).toBeUndefined();
  });

  it("does not hand the session out when beginning fails", async () => {
    const { driver, failBegin } = await make();

    failBegin();

    await expect(driver.beginTransaction()).rejects.toThrow("no");
    expect(databaseTransactionContext.getSession()).toBeUndefined();
  });

  it("keeps concurrent independent flows apart", async () => {
    const first = await make();
    const second = await make();
    const seenByBystander: unknown[] = [];

    const bystander = (async () => {
      seenByBystander.push(databaseTransactionContext.getSession());
      await tick();
      await tick();
      seenByBystander.push(databaseTransactionContext.getSession());
    })();

    const run = async (entry: typeof first, outcome: "commit" | "rollback") => {
      const tx = await entry.driver.beginTransaction();
      await tick();
      const seen = databaseTransactionContext.getSession();
      await tx[outcome]();

      return seen;
    };

    const [seenFirst, seenSecond] = await Promise.all([
      run(first, "commit"),
      run(second, "rollback"),
    ]);

    await bystander;

    expect(seenFirst).toBe(first.session);
    expect(seenSecond).toBe(second.session);
    expect(seenByBystander).toEqual([undefined, undefined]);
    expect(databaseTransactionContext.getSession()).toBeUndefined();
  });
});

describe.each(Object.entries(factories))("%s transaction()", (_name, make) => {
  beforeEach(() => databaseTransactionContext.clear());
  afterEach(() => databaseTransactionContext.clear());

  it("does not enter the caller's context while it runs", async () => {
    const { driver, session } = await make();
    const seenByCaller: unknown[] = [];
    let seenInside: unknown;

    const pending = driver.transaction(async () => {
      await tick();
      seenInside = databaseTransactionContext.getSession();
    });

    // Work the caller starts before awaiting the transaction
    seenByCaller.push(databaseTransactionContext.getSession());
    await tick();
    seenByCaller.push(databaseTransactionContext.getSession());

    await pending;

    expect(seenInside).toBe(session);
    expect(seenByCaller).toEqual([undefined, undefined]);
  });

  it("leaves the caller's flow without a session after it finishes", async () => {
    const { driver } = await make();

    await driver.transaction(async () => undefined);

    expect(databaseTransactionContext.getSession()).toBeUndefined();
    expect(databaseTransactionContext.hasActiveTransaction()).toBe(false);
  });
});
