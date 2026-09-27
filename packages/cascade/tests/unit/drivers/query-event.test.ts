import { describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoDbDriver } from "../../../src/drivers/mongodb/mongodb-driver";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";
import { createMockDriver } from "../../helpers/mock-driver";

function createPostgresDriver(query: ReturnType<typeof vi.fn>): PostgresDriver {
  const driver = new PostgresDriver({ database: "test" });
  (driver as unknown as { _pool: { query: typeof query } })._pool = { query };
  return driver;
}

describe("driver query events", () => {
  it("emits a Postgres query event with bindings, duration, and row count", async () => {
    const driver = createPostgresDriver(
      vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
    );
    const listener = vi.fn();
    driver.on("query", listener);

    await driver.query("SELECT * FROM users WHERE id = $1", [1]);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: "postgres",
        driver: "postgres",
        sql: "SELECT * FROM users WHERE id = $1",
        bindings: [1],
        rowCount: 1,
        durationMs: expect.any(Number),
        startedAt: expect.any(Number),
      }),
    );
  });

  it("emits a failing Postgres query event and rethrows the error", async () => {
    const error = new Error("database unavailable");
    const driver = createPostgresDriver(vi.fn().mockRejectedValue(error));
    const listener = vi.fn();
    driver.on("query", listener);

    await expect(driver.query("SELECT 1")).rejects.toThrow(error);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ error, sql: "SELECT 1" }));
  });

  it("never lets a throwing listener fail the query it observes", async () => {
    const driver = createPostgresDriver(
      vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
    );
    const listener = vi.fn(() => {
      throw new Error("observer bug");
    });
    driver.on("query", listener);

    const result = await driver.query("SELECT 1");

    expect(result.rows).toEqual([{ id: 1 }]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.not.objectContaining({ error: expect.anything() }));
  });

  it("stops delivery after off", async () => {
    const driver = createPostgresDriver(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));
    const listener = vi.fn();
    driver.on("query", listener);
    driver.off("query", listener);

    await driver.query("SELECT 1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not emit when query has no listeners", async () => {
    const driver = createPostgresDriver(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));
    const emit = vi.spyOn(driver as never, "emit" as never);

    await driver.query("SELECT 1");

    expect(emit).not.toHaveBeenCalled();
  });

  it("forwards query events with the registered data-source name", () => {
    dataSourceRegistry.clear();
    const driver = createMockDriver("postgres");
    const source = dataSourceRegistry.register({ name: "analytics", driver });
    const listener = vi.fn();
    dataSourceRegistry.on("query", listener);

    const queryListener = (driver.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === "query",
    )?.[1];
    queryListener?.({ connection: "postgres", driver: "postgres", durationMs: 1, startedAt: 1 });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ connection: source.name, driver: "postgres" }),
    );
    dataSourceRegistry.off("query", listener);
    dataSourceRegistry.clear();
  });

  it("emits Mongo command-monitoring events without driver metadata", () => {
    const driver = new MongoDbDriver({ database: "test" });
    const listener = vi.fn();
    driver.on("query", listener);

    (driver as unknown as { commandStarted(event: unknown): void }).commandStarted({
      requestId: 1,
      commandName: "find",
      command: {
        find: "users",
        filter: { active: true },
        lsid: { id: "session" },
        $clusterTime: { clusterTime: "now" },
        $db: "test",
      },
    });
    (driver as unknown as { commandSucceeded(event: unknown): void }).commandSucceeded({
      requestId: 1,
      reply: { cursor: { firstBatch: [{ id: 1 }] } },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        driver: "mongodb",
        connection: "mongodb",
        command: "find",
        collection: "users",
        pipeline: { find: "users", filter: { active: true } },
        rowCount: 1,
      }),
    );
  });
});
