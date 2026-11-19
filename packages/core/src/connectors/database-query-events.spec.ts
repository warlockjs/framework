import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoDbDriver } from "@warlock.js/cascade";
import { resetRolesCacheForTests } from "../application/roles";

const connectToDatabase = vi.hoisted(() => vi.fn(async () => ({ name: "default" })));

vi.mock("@warlock.js/cascade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@warlock.js/cascade")>()),
  connectToDatabase,
}));

import { DatabaseConnector } from "./database-connector";
import {
  DEVTOOLS_PRODUCTION_REQUESTED,
  resolveDatabaseConnectionConfig,
} from "./database-query-events";

/**
 * The request log counts queries from the ORM's query events, which MongoDB
 * emits in production only with `queryEvents: true`: core turns them on when
 * the request log captures queries and the app left `queryEvents` unset.
 */
describe("database connection queryEvents", () => {
  const originalRoles = process.env.WARLOCK_ROLES;

  beforeEach(() => {
    delete process.env.WARLOCK_ROLES;
    resetRolesCacheForTests();
  });

  afterEach(() => {
    config.set("http", undefined);
    config.set("database", undefined);
    config.set("devtools", undefined);
    delete (globalThis as Record<symbol, unknown>)[DEVTOOLS_PRODUCTION_REQUESTED];
    connectToDatabase.mockClear();

    if (originalRoles === undefined) delete process.env.WARLOCK_ROLES;
    else process.env.WARLOCK_ROLES = originalRoles;

    resetRolesCacheForTests();
  });

  const database = { driver: "mongodb", database: "app" };

  it("turns query events on when the request log captures queries and the app left them unset", async () => {
    config.set("http", { logging: { requests: { enabled: true } } });
    config.set("database", database);

    await new DatabaseConnector().start();

    expect(connectToDatabase).toHaveBeenCalledWith({ ...database, queryEvents: true });
  });

  it("leaves queryEvents unset when the request log is off", () => {
    config.set("http", { logging: { requests: { enabled: false } } });

    expect(resolveDatabaseConnectionConfig(database)).toEqual(database);
  });

  it("leaves queryEvents unset when the request log does not capture queries", () => {
    config.set("http", { logging: { requests: { enabled: true, include: { queries: false } } } });

    expect(resolveDatabaseConnectionConfig(database)).toEqual(database);
  });

  it("leaves queryEvents unset in a process that serves no HTTP", () => {
    process.env.WARLOCK_ROLES = "worker";
    resetRolesCacheForTests();
    config.set("http", { logging: { requests: { enabled: true } } });

    expect(resolveDatabaseConnectionConfig(database)).toEqual(database);
  });

  it("turns query events on for the devtools production monitor even with the request log off", () => {
    config.set("http", { logging: { requests: { enabled: false } } });
    config.set("devtools", { production: { enabled: true } });

    expect(resolveDatabaseConnectionConfig(database)).toEqual({ ...database, queryEvents: true });
    expect(resolveDatabaseConnectionConfig({ ...database, queryEvents: false })).toEqual({
      ...database,
      queryEvents: false,
    });

    process.env.WARLOCK_ROLES = "worker";
    resetRolesCacheForTests();

    expect(resolveDatabaseConnectionConfig(database)).toEqual(database);
  });

  it("turns query events on when the monitor is enabled only through the connector's options", () => {
    config.set("http", { logging: { requests: { enabled: false } } });
    (globalThis as Record<symbol, unknown>)[DEVTOOLS_PRODUCTION_REQUESTED] = true;

    expect(resolveDatabaseConnectionConfig(database)).toEqual({ ...database, queryEvents: true });
    expect(resolveDatabaseConnectionConfig({ ...database, queryEvents: false })).toEqual({
      ...database,
      queryEvents: false,
    });

    process.env.WARLOCK_ROLES = "worker";
    resetRolesCacheForTests();

    expect(resolveDatabaseConnectionConfig(database)).toEqual(database);
  });

  it("keeps an explicit queryEvents: false with the request log on", () => {
    config.set("http", { logging: { requests: { enabled: true } } });

    expect(resolveDatabaseConnectionConfig({ ...database, queryEvents: false })).toEqual({
      ...database,
      queryEvents: false,
    });
  });

  it("gives a production MongoDB driver query events only when the request log captures them", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      config.set("http", { logging: { requests: { enabled: true } } });
      const capturing = new MongoDbDriver(resolveDatabaseConnectionConfig({ database: "app" }));
      // An explicit false stays off; cascade's registry then warns once,
      // naming `queryEvents: true`, when the request log's listener attaches.
      const optedOut = new MongoDbDriver(
        resolveDatabaseConnectionConfig({ database: "app", queryEvents: false }),
      );

      config.set("http", { logging: { requests: { enabled: false } } });
      const quiet = new MongoDbDriver(resolveDatabaseConnectionConfig({ database: "app" }));

      expect(capturing.queryEventsEnabled).toBe(true);
      expect(optedOut.queryEventsEnabled).toBe(false);
      expect(quiet.queryEventsEnabled).toBe(false);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
