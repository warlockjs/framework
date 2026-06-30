import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDriver, type InMemoryDriver } from "./in-memory-driver";

/**
 * S6 — injectable seed clock + meaningful `Seeder.batchSize`.
 *
 * `@warlock.js/cascade` is mocked exactly as in the sibling manager test:
 * `transaction` runs inline, `migrationRunner` is a no-op, and the datasource
 * is INJECTED so `dataSourceRegistry` is never consulted.
 *
 * Covers: the overridable `clock` flows to the seeder's `now()`, to the tracked
 * ref `runAt`, AND to the seeds-log metadata timestamps (firstRunAt / lastRunAt
 * / createdAt); `batchSize` is surfaced from the Seeder (and defaults to 0);
 * the default clock is still a live `new Date()`.
 *
 * NO real database — Docker / Mongo / Postgres are not used.
 */

vi.mock("@warlock.js/cascade", () => {
  return {
    transaction: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) => fn({})),
    migrationRunner: { run: vi.fn(async () => undefined) },
    dataSourceRegistry: { get: vi.fn(() => undefined) },
    DatabaseWriterValidationError: class DatabaseWriterValidationError extends Error {},
    Migration: class Migration {},
  };
});

import { SeedersManager } from "../../../../src/database/seeds/seeders.manager";
import type { SeedContext } from "../../../../src/database/seeds/types";
import { seedRecordsTableName, seedsTableName } from "../../../../src/database/seeds/utils";

/** Lightweight model double exposing the `track`-required surface. */
function model(table: string, id: number | string) {
  return { getTableName: () => table, id };
}

function makeManager(memory: InMemoryDriver, clock?: () => Date) {
  // Pre-create both tracking tables so init() skips migrationRunner.run.
  memory.createTable(seedsTableName);
  memory.createTable(seedRecordsTableName);

  const datasource = { driver: memory.driver } as any;

  return new SeedersManager({ datasource, clock });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("SeedersManager — injectable clock (now)", () => {
  it("flows the injected clock to the seeder's now()", async () => {
    const fixed = new Date("2021-01-02T03:04:05.000Z");
    const memory = createInMemoryDriver();
    const manager = makeManager(memory, () => fixed);

    let seen: Date | undefined;

    manager.register({
      name: "historical",
      async run({ track, now }: SeedContext) {
        seen = now();
        track(model("users", 1));
      },
    });

    await manager.run();

    expect(seen).toBe(fixed);
  });

  it("seeds a created_at equal to the injected clock's date", async () => {
    const fixed = new Date("2019-07-04T12:00:00.000Z");
    const memory = createInMemoryDriver();
    const manager = makeManager(memory, () => fixed);

    manager.register({
      name: "users",
      async run({ track, now }: SeedContext) {
        // A seed writing a historical timestamp reads the injected clock.
        const created = await memory.driver.insert("users", {
          name: "Root",
          created_at: now(),
        });
        track("users", created.id);
      },
    });

    await manager.run();

    const user = memory.rowsOf("users").find((row) => row.name === "Root");

    expect(user?.created_at).toBe(fixed);
    expect((user?.created_at as Date).toISOString()).toBe(
      "2019-07-04T12:00:00.000Z",
    );
  });

  it("stamps tracked ref runAt from the injected clock", async () => {
    const fixed = new Date("2020-05-05T05:05:05.000Z");
    const memory = createInMemoryDriver();
    const manager = makeManager(memory, () => fixed);

    manager.register({
      name: "catalog",
      async run({ track }: SeedContext) {
        track(model("products", 10));
      },
    });

    await manager.run();

    const refs = memory.rowsOf(seedRecordsTableName);
    expect(refs).toHaveLength(1);
    expect(refs[0].runAt).toBe(fixed);
  });

  it("stamps the seeds-log metadata timestamps from the injected clock (insert path)", async () => {
    const fixed = new Date("2018-03-03T00:00:00.000Z");
    const memory = createInMemoryDriver();
    const manager = makeManager(memory, () => fixed);

    manager.register({
      name: "meta",
      async run({ track }: SeedContext) {
        track(model("things", 1));
      },
    });

    await manager.run();

    const log = memory.rowsOf(seedsTableName).find((row) => row.name === "meta");

    expect(log?.createdAt).toBe(fixed);
    expect(log?.firstRunAt).toBe(fixed);
    expect(log?.lastRunAt).toBe(fixed);
  });

  it("stamps lastRunAt from the injected clock on the update (re-run) path", async () => {
    let current = new Date("2022-01-01T00:00:00.000Z");
    const memory = createInMemoryDriver();
    const manager = makeManager(memory, () => current);

    manager.register({
      name: "rerun",
      async run({ track }: SeedContext) {
        track(model("rows", 1));
      },
    });

    await manager.run(); // insert path @ 2022-01-01

    const later = new Date("2023-09-09T09:09:09.000Z");
    current = later;

    await manager.run(); // update path @ 2023-09-09

    const log = memory.rowsOf(seedsTableName).find((row) => row.name === "rerun");

    // firstRunAt/createdAt stay at the original insert time…
    expect(log?.firstRunAt).toEqual(new Date("2022-01-01T00:00:00.000Z"));
    // …while lastRunAt advances to the clock's value at the re-run.
    expect(log?.lastRunAt).toBe(later);
    expect(log?.runCount).toBe(2);
  });

  it("defaults to a live new Date() clock when no override is given", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory); // no clock override

    let seen: Date | undefined;
    const before = Date.now();

    manager.register({
      name: "default-clock",
      async run({ now }: SeedContext) {
        seen = now();
      },
    });

    await manager.run();

    const after = Date.now();

    expect(seen).toBeInstanceOf(Date);
    expect(seen!.getTime()).toBeGreaterThanOrEqual(before);
    expect(seen!.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("SeedersManager — batchSize surfaced from the Seeder", () => {
  it("forwards the seeder's batchSize to the run context", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    let seen: number | undefined;

    manager.register({
      name: "bulk",
      batchSize: 250,
      async run({ batchSize }: SeedContext) {
        seen = batchSize;
      },
    });

    await manager.run();

    expect(seen).toBe(250);
  });

  it("defaults batchSize to 0 when the seeder declares none", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    let seen: number | undefined;

    manager.register({
      name: "no-batch",
      async run({ batchSize }: SeedContext) {
        seen = batchSize;
      },
    });

    await manager.run();

    expect(seen).toBe(0);
  });
});
