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
 *    leaked the client the same way. Fixed so a failing COMMIT or ROLLBACK
 *    releases exactly once, and with the error (`release(error)`), so pg
 *    discards the client instead of recycling one left in an unknown
 *    transaction state. `transaction()` no longer issues ROLLBACK after a
 *    failed COMMIT — the client is already released, and doing so would
 *    touch a released client, double-release it, and could mask the
 *    original COMMIT error.
 * 3. `new pg.Pool(poolConfig)` had no `error` listener. pg's Pool emits
 *    `'error'` for problems on an already-idle client (a dropped idle
 *    connection — the "Connection terminated unexpectedly" symptom); with no
 *    listener, Node's EventEmitter throws synchronously and would crash (or
 *    at minimum go unhandled and poison) the process.
 * 4. `connectionTimeoutMillis` defaulted to 2000ms, too tight for queued
 *    checkouts under concurrency; raised to 10000ms. `keepAlive` was never
 *    passed to pg at all; now defaults to `true`.
 *
 * `query()` does NOT retry. An earlier version of this fix retried once for
 * anything that looked like a `SELECT` on a "connection terminated" error,
 * but SQL text isn't a reliable idempotency signal — `SELECT nextval('seq')`
 * and `SELECT some_write_function()` both change state, and retrying after
 * the connection drops between the side effect and the response would
 * duplicate it. Removed; see the "no retry" describe block below.
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
      // Released WITH the error, so pg discards rather than recycles a
      // client left in an unknown transaction state.
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
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
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
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

  describe("transaction() — a failed COMMIT is not followed by ROLLBACK", () => {
    it("propagates the original COMMIT error, releases exactly once with release(error), and never issues ROLLBACK", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      const commitError = new Error("Connection terminated unexpectedly");
      client.query.mockImplementation((sql: string) => {
        if (sql === "COMMIT") {
          return Promise.reject(commitError);
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      connect.mockResolvedValue(client);

      await expect(driver.transaction(async () => "ok")).rejects.toBe(commitError);

      const queriedSql = client.query.mock.calls.map(([sql]) => sql);
      expect(queriedSql).not.toContain("ROLLBACK");

      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(commitError);
    });

    it("still rolls back when the callback itself throws (COMMIT never reached)", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      connect.mockResolvedValue(client);
      const callbackError = new Error("callback exploded");

      await expect(
        driver.transaction(async () => {
          throw callbackError;
        }),
      ).rejects.toBe(callbackError);

      const queriedSql = client.query.mock.calls.map(([sql]) => sql);
      expect(queriedSql).toContain("ROLLBACK");
      expect(queriedSql).not.toContain("COMMIT");
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("keeps the callback's error when ROLLBACK also fails, releasing once with the rollback error", async () => {
      const driver = await connectedDriver();
      const client = makeClient();
      const rollbackError = new Error("Connection terminated unexpectedly");
      client.query.mockImplementation((sql: string) =>
        sql === "ROLLBACK"
          ? Promise.reject(rollbackError)
          : Promise.resolve({ rows: [], rowCount: 0 }),
      );
      connect.mockResolvedValue(client);
      const callbackError = new Error("callback exploded");

      await expect(
        driver.transaction(async () => {
          throw callbackError;
        }),
      ).rejects.toBe(callbackError);

      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(rollbackError);
    });
  });

  describe("query() — no automatic retry (removed: SQL-text idempotency is not a safe signal)", () => {
    it("does NOT retry a connection-terminated error, even on a plain SELECT", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

      await expect(driver.query("SELECT * FROM posts")).rejects.toThrow(
        "Connection terminated unexpectedly",
      );

      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry SELECT nextval('seq') — a 'read-only-looking' SELECT that mutates state", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

      await expect(driver.query("SELECT nextval('seq')")).rejects.toThrow(
        "Connection terminated unexpectedly",
      );

      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a non-SELECT statement either", async () => {
      const driver = await connectedDriver();
      poolQuery.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

      await expect(
        driver.query("UPDATE posts SET title = $1 WHERE id = $2", ["x", 1]),
      ).rejects.toThrow("Connection terminated unexpectedly");

      expect(poolQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("buildPostgresPoolConfig — still exported and unchanged for the coercion specs", () => {
    it("smoke test: default export is callable", () => {
      expect(buildPostgresPoolConfig({ database: "test" } as never)).toBeDefined();
    });
  });
});
