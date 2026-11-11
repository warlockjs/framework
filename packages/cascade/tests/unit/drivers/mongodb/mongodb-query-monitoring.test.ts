import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import {
  describeCommandFailure,
  describeCommandShape,
} from "../../../../src/drivers/mongodb/mongodb-command-shape";
import { MongoDbDriver } from "../../../../src/drivers/mongodb/mongodb-driver";
import { createMockDriver } from "../../../helpers/mock-driver";

/**
 * Query observation costs nothing unless someone observes: the registry
 * subscribes to a driver's `query` event only while it has a `query`
 * listener itself, and MongoDB command monitoring (which decodes every reply
 * twice) is on only when the query log or `query` events need it. The query
 * log never carries document or filter values.
 */
describe("registry query forwarding", () => {
  afterEach(() => {
    dataSourceRegistry.clear();
  });

  const queryListenersOf = (driver: ReturnType<typeof createMockDriver>) =>
    (driver.on as ReturnType<typeof vi.fn>).mock.calls.filter(([event]) => event === "query");

  it("does not listen to a driver's query event while nobody listens to the registry", () => {
    const driver = createMockDriver("postgres");

    dataSourceRegistry.register({ name: "main", driver });

    expect(queryListenersOf(driver)).toHaveLength(0);
  });

  it("attaches on the first registry listener and detaches after the last", () => {
    const driver = createMockDriver("postgres");
    dataSourceRegistry.register({ name: "main", driver });
    const first = vi.fn();
    const second = vi.fn();

    dataSourceRegistry.on("query", first);
    dataSourceRegistry.on("query", second);

    expect(queryListenersOf(driver)).toHaveLength(1);

    const forward = queryListenersOf(driver)[0]?.[1];
    forward?.({ connection: "postgres", driver: "postgres", durationMs: 1, startedAt: 1 });
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ connection: "main" }));

    dataSourceRegistry.off("query", first);
    expect(driver.off).not.toHaveBeenCalled();

    dataSourceRegistry.off("query", second);
    expect(driver.off).toHaveBeenCalledWith("query", forward);
  });

  it("attaches to a source registered while someone listens", () => {
    const listener = vi.fn();
    dataSourceRegistry.on("query", listener);

    const driver = createMockDriver("postgres");
    dataSourceRegistry.register({ name: "late", driver });

    expect(queryListenersOf(driver)).toHaveLength(1);
    dataSourceRegistry.off("query", listener);
  });

  it("warns once when a listener attaches to a source that emits no query events", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const driver = Object.assign(createMockDriver("mongodb"), { queryEventsEnabled: false });
    dataSourceRegistry.register({ name: "quiet", driver });
    const first = vi.fn();
    const second = vi.fn();

    dataSourceRegistry.on("query", first);
    dataSourceRegistry.off("query", first);
    dataSourceRegistry.on("query", second);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[2]).toContain("queryEvents: true");
    dataSourceRegistry.off("query", second);
    warn.mockRestore();
  });

  it("does not warn for a source that emits query events", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const driver = Object.assign(createMockDriver("mongodb"), { queryEventsEnabled: true });
    dataSourceRegistry.register({ name: "loud", driver });
    const listener = vi.fn();

    dataSourceRegistry.on("query", listener);

    expect(warn).not.toHaveBeenCalled();
    dataSourceRegistry.off("query", listener);
    warn.mockRestore();
  });

  it("detaches from a replaced source", () => {
    const listener = vi.fn();
    dataSourceRegistry.on("query", listener);

    const oldDriver = createMockDriver("postgres");
    dataSourceRegistry.register({ name: "main", driver: oldDriver });
    dataSourceRegistry.register({ name: "main", driver: createMockDriver("postgres") });

    expect(oldDriver.off).toHaveBeenCalledWith("query", expect.any(Function));
    dataSourceRegistry.off("query", listener);
  });
});

describe("MongoDB command monitoring", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function monitorCommandsOf(
    config: Record<string, unknown> = {},
    clientOptions?: Record<string, unknown>,
  ): unknown {
    const driver = new MongoDbDriver({ database: "test", ...config, clientOptions } as never);

    return (
      driver as unknown as { buildClientOptions(): { monitorCommands?: boolean } }
    ).buildClientOptions().monitorCommands;
  }

  it("is off in production by default", () => {
    process.env.NODE_ENV = "production";

    expect(monitorCommandsOf()).toBe(false);
  });

  it("stays on outside production by default", () => {
    process.env.NODE_ENV = "development";

    expect(monitorCommandsOf()).toBe(true);
  });

  it("is on with logging or queryEvents", () => {
    process.env.NODE_ENV = "production";

    expect(monitorCommandsOf({ logging: true })).toBe(true);
    expect(monitorCommandsOf({ queryEvents: true })).toBe(true);
  });

  it("is off with queryEvents: false outside production", () => {
    process.env.NODE_ENV = "development";

    expect(monitorCommandsOf({ queryEvents: false })).toBe(false);
  });

  it("keeps an explicit clientOptions.monitorCommands", () => {
    process.env.NODE_ENV = "production";

    expect(monitorCommandsOf({}, { monitorCommands: true })).toBe(true);
  });

  it("reports the same setting through queryEventsEnabled", () => {
    process.env.NODE_ENV = "production";

    expect(new MongoDbDriver({ database: "test" }).queryEventsEnabled).toBe(false);
    expect(new MongoDbDriver({ database: "test", queryEvents: true }).queryEventsEnabled).toBe(
      true,
    );
  });
});

describe("MongoDB query log redaction", () => {
  it("logs the command, collection and shape but no values", () => {
    const shape = describeCommandShape({
      insert: "users",
      documents: [{ email: "ann@example.com", password: "$2b$10$secrethash", age: 31 }],
      lsid: { id: "session" },
      $db: "app",
    });
    const text = JSON.stringify(shape);

    expect(shape).toEqual({
      insert: "users",
      documents: ["1 ×", { email: "string", password: "string", age: "number" }],
    });
    expect(text).not.toContain("secrethash");
    expect(text).not.toContain("ann@example.com");
  });

  it("keeps filter field names and pipeline stage names", () => {
    const shape = describeCommandShape({
      aggregate: "sessions",
      pipeline: [{ $match: { refreshToken: "tok_live_123" } }],
      cursor: {},
    });

    expect(JSON.stringify(shape)).not.toContain("tok_live_123");
    expect(shape.pipeline).toEqual(["1 ×", { $match: { refreshToken: "string" } }]);
  });

  it("strips the duplicate-key value from a failure", () => {
    const failure = describeCommandFailure(
      Object.assign(new Error('E11000 duplicate key error dup key: { apiKey: "key_123" }'), {
        code: 11000,
        codeName: "DuplicateKey",
      }),
    );

    expect(JSON.stringify(failure)).not.toContain("key_123");
    expect(failure).toMatchObject({ code: 11000, codeName: "DuplicateKey" });
  });
});
