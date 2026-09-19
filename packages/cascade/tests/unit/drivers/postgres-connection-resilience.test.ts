import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Card ba1193b4 — under a 10-minute soak at concurrency 10 on the blog (prod,
 * local Postgres 18, Windows), pg-pool produced:
 *   - `Error: timeout exceeded when trying to connect` (Query Builder Error)
 *   - `Error: Connection terminated due to connection timeout`, cause
 *     `Connection terminated unexpectedly`
 * on 8 of ~N requests, plus 500s on the first requests after the server sat
 * idle.
 *
 * Root causes fixed alongside these specs, all in
 * `cascade/src/drivers/postgres/postgres-driver.ts`:
 *
 * 1. `beginTransaction()` checked out a client with `pool.connect()` but
 *    never released it if the `BEGIN` query itself threw — a leaked client
 *    per failed transaction start, which exhausts the pool under
 *    concurrency and reproduces exactly the "timeout exceeded when trying
 *    to connect" symptom for every caller queued behind it.
 * 2. `commit()` / `rollback()` released the client only on the statement
 *    after `COMMIT`/`ROLLBACK` succeeded — a throw from that query (e.g. the
 *    connection was terminated mid-transaction) skipped `release()` and
 *    leaked the client the same way.
 * 3. `new pg.Pool(poolConfig)` had no `error` listener. pg's Pool emits
 *    `'error'` for problems on an already-idle client (a dropped idle
 *    connection — the "Connection terminated unexpectedly" symptom); with no
 *    listener, Node's EventEmitter throws synchronously and would crash (or
 *    at minimum go unhandled and poison) the process.
 * 4. `connectionTimeoutMillis` defaulted to 2000ms, too tight for queued
 *    checkouts under concurrency; raised to 10000ms. `keepAlive` was never
 *    passed to pg at all; now defaults to `true`.
 * 5. `query()` now retries once, only for a `SELECT` outside a transaction,
 *    when the failure is pg's "connection terminated" family — covers the
 *    "first request after the server sat idle" symptom where the pool hands
 *    out a client whose socket was already closed by the OS/NAT.
 */

const connect = vi.fn();
const poolQuery = vi.fn();
const poolOn = vi.fn();
const poolEnd = vi.fn();

class MockPool {
  public connect = connect;
  public query = poolQuery;
  public on = poolOn;
  public end = poolEnd;
}

vi.mock("pg", () => ({
  default: { Pool: MockPool },
  Pool: MockPool,
}));

// Imported after the mock so the driver's dynamic `import("pg")` resolves to it.
const { PostgresDriver, buildPostgresPoolConfig } =
  await import("../../../src/drivers/postgres/postgres-driver");

function makeClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
}

/**
 * `beginTransaction()` / `query()` both go through the `pool` getter, which
 * throws unless `connect()` has run. Drive a real `connect()` first (its own
 * connection-test checkout + native-array-column introspection query), then
 * reset the pool-level mocks so each test's own expectations start clean.
 */
async function connectedDriver() {
  const driver = new PostgresDriver({ database: "test" });
  connect.mockResolvedValue(makeClient());
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await driver.connect();

  connect.mockReset();
  poolQuery.mockReset();

  return driver;
}

describe("PostgresDriver — connection resilience (ba1193b4)", () => {
  beforeEach(() => {
    connect.mockReset();
    poolQuery.mockReset();
    poolOn.mockReset();
    poolEnd.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connect() — pool error listener", () => {
    it("registers an 'error' listener on the pool so an idle-client drop can't crash the process", async () => {
      const driver = new PostgresDriver({ database: "test" });
      connect.mockResolvedValue(makeClient());

      await driver.connect();

      expect(poolOn).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("the registered listener does not throw when invoked with a terminated-connection error", async () => {
      const driver = new PostgresDriver({ database: "test" });
      connect.mockResolvedValue(makeClient());

      await driver.connect();

      const [, listener] = poolOn.mock.calls.find(([event]) => event === "error")!;

      expect(() => listener(new Error("Connection terminated unexpectedly"))).not.toThrow();
    });
  });

  describe("beginTransaction() — release on every path", () => {
    it("releases the client when BEGIN itself throws", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      client.query.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
      connect.mockResolvedValue(client);

      await expect(driver.beginTransaction()).rejects.toThrow("Connection terminated unexpectedly");

      expect(client.release).toHaveBeenCalledTimes(1);
      // Passed the error so pg destroys rather than recycles a broken client.
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    });

    it("releases the client when COMMIT throws", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      client.query.mockImplementation((sql: string) => {
        if (sql === "COMMIT") {
          return Promise.reject(new Error("Connection terminated unexpectedly"));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      connect.mockResolvedValue(client);

      const tx = await driver.beginTransaction();

      await expect(tx.commit()).rejects.toThrow("Connection terminated unexpectedly");
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("releases the client when ROLLBACK throws", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      client.query.mockImplementation((sql: string) => {
        if (sql === "ROLLBACK") {
          return Promise.reject(new Error("Connection terminated unexpectedly"));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      connect.mockResolvedValue(client);

      const tx = await driver.beginTransaction();

      await expect(tx.rollback()).rejects.toThrow("Connection terminated unexpectedly");
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("still releases exactly once on the happy path (no leak, no double-release)", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      connect.mockResolvedValue(client);

      const tx = await driver.beginTransaction();
      await tx.commit();

      expect(client.release).toHaveBeenCalledTimes(1);
    });
  });

  describe("query() — one-time retry on a connection-terminated error", () => {
    it("retries an idempotent SELECT once and returns the retry's result", async () => {
      const driver = await connectedDriver();
      poolQuery
        .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await driver.query("SELECT * FROM posts WHERE id = $1", [1]);

      expect(result.rows).toEqual([{ id: 1 }]);
      expect(poolQuery).toHaveBeenCalledTimes(2);
    });

    it("retries when the timeout error carries 'Connection terminated unexpectedly' as its cause", async () => {
      const driver = await connectedDriver();
      const timeoutError = new Error("Connection terminated due to connection timeout", {
        cause: new Error("Connection terminated unexpectedly"),
      });
      poolQuery
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 });

      const result = await driver.query("select * from posts");

      expect(result.rows).toEqual([{ id: 2 }]);
      expect(poolQuery).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a non-SELECT statement (would double-apply a write)", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

      await expect(
        driver.query("UPDATE posts SET title = $1 WHERE id = $2", ["x", 1]),
      ).rejects.toThrow("Connection terminated unexpectedly");

      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a SELECT that fails for an unrelated reason", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValueOnce(new Error('column "bogus" does not exist'));

      await expect(driver.query("SELECT bogus FROM posts")).rejects.toThrow(
        'column "bogus" does not exist',
      );

      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it("only retries once — a SELECT that keeps failing surfaces the error", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValue(new Error("Connection terminated unexpectedly"));

      await expect(driver.query("SELECT * FROM posts")).rejects.toThrow(
        "Connection terminated unexpectedly",
      );

      expect(poolQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("buildPostgresPoolConfig — still exported and unchanged for the coercion specs", () => {
    it("smoke test: default export is callable", () => {
      expect(buildPostgresPoolConfig({ database: "test" } as never)).toBeDefined();
    });
  });
});
