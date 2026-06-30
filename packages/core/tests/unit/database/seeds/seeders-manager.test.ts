import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDriver, type InMemoryDriver } from "./in-memory-driver";

/**
 * SeedersManager behavior WITHOUT a database. `@warlock.js/cascade` is mocked so
 * the manager loads in isolation: `transaction` runs the callback inline,
 * `migrationRunner` is a no-op (tables are pre-created in the fake driver), and
 * the datasource is INJECTED via `SeedersManagerOptions` so `dataSourceRegistry`
 * is never consulted.
 *
 * Covers: track-count == recordsCreated, track(model) records table+id, the
 * track overloads (model / models[] / raw table+id), backward-compat for a
 * zero-arg `run()` returning a count or void, and `dependsOn` topological
 * ordering / cycle / unknown-dep errors (S5).
 *
 * NO real database — Docker / Mongo / Postgres are not used.
 */

vi.mock("@warlock.js/cascade", () => {
  return {
    // Run the wrapped callback inline so the "same transaction" path is exercised.
    transaction: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) => fn({})),
    migrationRunner: { run: vi.fn(async () => undefined) },
    dataSourceRegistry: { get: vi.fn(() => undefined) },
    DatabaseWriterValidationError: class DatabaseWriterValidationError extends Error {},
    // Base class for the seed-records migration file import.
    Migration: class Migration {},
  };
});

import { SeedersManager } from "../../../../src/database/seeds/seeders.manager";
import {
  SeederDependencyCycleError,
  UnknownSeederDependencyError,
} from "../../../../src/database/seeds/seeder.errors";
import type { SeedContext } from "../../../../src/database/seeds/types";
import { seedRecordsTableName, seedsTableName } from "../../../../src/database/seeds/utils";

/** Lightweight model double exposing the `track`-required surface. */
function model(table: string, id: number | string) {
  return { getTableName: () => table, id };
}

function makeManager(memory: InMemoryDriver) {
  // Pre-create both tracking tables so init() skips migrationRunner.run.
  memory.createTable(seedsTableName);
  memory.createTable(seedRecordsTableName);

  const datasource = { driver: memory.driver } as any;

  return new SeedersManager({ datasource });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("SeedersManager.run — track()", () => {
  it("auto-derives recordsCreated from the track count", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    manager.register({
      name: "users",
      async run({ track }: SeedContext) {
        track(model("users", 1));
        track(model("users", 2));
        track(model("users", 3));
      },
    });

    await manager.run();

    const log = memory
      .rowsOf(seedsTableName)
      .find((row) => row.name === "users");

    expect(log?.lastRunRecordsCreated).toBe(3);
    expect(log?.totalRecordsCreated).toBe(3);
  });

  it("records table + id for each tracked model", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    manager.register({
      name: "catalog",
      async run({ track }: SeedContext) {
        track(model("products", 10));
        track(model("categories", 99));
      },
    });

    await manager.run();

    const refs = memory.rowsOf(seedRecordsTableName);

    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => [ref.seeder, ref.table, ref.recordId])).toEqual([
      ["catalog", "products", 10],
      ["catalog", "categories", 99],
    ]);
  });

  it("supports the bulk track(models[]) overload and returns its argument", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);
    const created = [model("tags", 1), model("tags", 2)];
    let returned: unknown;

    manager.register({
      name: "tags",
      async run({ track }: SeedContext) {
        returned = track(created);
      },
    });

    await manager.run();

    expect(returned).toBe(created);
    expect(memory.rowsOf(seedRecordsTableName)).toHaveLength(2);
  });

  it("supports the raw track(table, id) escape hatch", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);
    let returned: unknown;

    manager.register({
      name: "raw",
      async run({ track }: SeedContext) {
        returned = track("legacy_table", "abc-123");
      },
    });

    await manager.run();

    expect(returned).toBe("legacy_table");

    const refs = memory.rowsOf(seedRecordsTableName);
    expect(refs).toHaveLength(1);
    expect(refs[0].table).toBe("legacy_table");
    expect(refs[0].recordId).toBe("abc-123");
  });

  it("keeps only LAST-RUN refs — prior refs for the seeder are dropped before re-run", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    let pass = 0;

    manager.register({
      name: "repeat",
      async run({ track }: SeedContext) {
        pass++;
        track(model("things", pass * 10));
        if (pass === 1) {
          track(model("things", pass * 10 + 1));
        }
      },
    });

    await manager.run(); // pass 1: 2 refs
    await manager.run(); // pass 2: 1 ref, prior 2 dropped

    const refs = memory.rowsOf(seedRecordsTableName);
    expect(refs).toHaveLength(1);
    expect(refs[0].recordId).toBe(20);
  });
});

describe("SeedersManager.run — backward compatibility", () => {
  it("a zero-arg run() returning a SeedResult still records recordsCreated", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    manager.register({
      name: "legacy-count",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async run() {
        return { recordsCreated: 7 };
      },
    });

    await manager.run();

    const log = memory
      .rowsOf(seedsTableName)
      .find((row) => row.name === "legacy-count");

    expect(log?.lastRunRecordsCreated).toBe(7);
    expect(memory.rowsOf(seedRecordsTableName)).toHaveLength(0);
  });

  it("a zero-arg run() returning void records zero and still logs the run", async () => {
    const memory = createInMemoryDriver();
    const manager = makeManager(memory);

    manager.register({
      name: "legacy-void",
      async run() {
        // no return, no track
      },
    });

    await manager.run();

    const log = memory
      .rowsOf(seedsTableName)
      .find((row) => row.name === "legacy-void");

    expect(log).toBeDefined();
    expect(log?.lastRunRecordsCreated).toBe(0);
  });
});

describe("SeedersManager.prepareSeeders — dependsOn (S5)", () => {
  function names(manager: SeedersManager): string[] {
    return manager.seeders.map((seeder) => seeder.name);
  }

  it("orders dependencies before dependents", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    manager.register(
      { name: "admin-user", dependsOn: ["roles"], order: 10, async run() {} },
      { name: "roles", order: 20, async run() {} },
    );

    manager.prepareSeeders();

    // roles must precede admin-user despite its higher numeric order.
    expect(names(manager)).toEqual(["roles", "admin-user"]);
  });

  it("preserves numeric order as the tie-break among dependency-free seeders", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    manager.register(
      { name: "c", order: 30, async run() {} },
      { name: "a", order: 10, async run() {} },
      { name: "b", order: 20, async run() {} },
    );

    manager.prepareSeeders();

    expect(names(manager)).toEqual(["a", "b", "c"]);
  });

  it("resolves a multi-level dependency chain", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    manager.register(
      { name: "c", dependsOn: ["b"], async run() {} },
      { name: "b", dependsOn: ["a"], async run() {} },
      { name: "a", async run() {} },
    );

    manager.prepareSeeders();

    expect(names(manager)).toEqual(["a", "b", "c"]);
  });

  it("throws UnknownSeederDependencyError for a missing dependency", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    manager.register({ name: "a", dependsOn: ["ghost"], async run() {} });

    expect(() => manager.prepareSeeders()).toThrow(UnknownSeederDependencyError);
    expect(() => manager.prepareSeeders()).toThrow(/depends on "ghost"/);
  });

  it("throws SeederDependencyCycleError on a cycle", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    manager.register(
      { name: "a", dependsOn: ["b"], async run() {} },
      { name: "b", dependsOn: ["a"], async run() {} },
    );

    expect(() => manager.prepareSeeders()).toThrow(SeederDependencyCycleError);
    expect(() => manager.prepareSeeders()).toThrow(/cycle detected/);
  });

  it("ignores dependsOn pointing at a disabled (filtered-out) seeder by erroring", () => {
    const datasource = { driver: createInMemoryDriver().driver } as any;
    const manager = new SeedersManager({ datasource });

    // `disabled` is filtered out before resolution, so `a` references a
    // now-unknown dependency — a clear error beats a silently dropped edge.
    manager.register(
      { name: "disabled", enabled: false, async run() {} },
      { name: "a", dependsOn: ["disabled"], async run() {} },
    );

    expect(() => manager.prepareSeeders()).toThrow(UnknownSeederDependencyError);
  });
});
