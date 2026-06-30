import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDriver, type InMemoryDriver } from "./in-memory-driver";

/**
 * `dropSeedRecords` (warlock seed --drop) behavior WITHOUT a database.
 *
 * `@warlock.js/cascade` is mocked (`transaction` runs inline). The dev-server +
 * core-utils imports that `seed-command-action.ts` pulls in for file discovery
 * are stubbed so the module loads in isolation — we only exercise the pure
 * `dropSeedRecords` undo logic against the in-memory driver.
 *
 * Covers: deletes only tracked rows (untracked rows survive), reverse-id delete
 * order, resets the matching seeds-log rows (so `once: true` re-runs), and
 * single-seeder scoping.
 *
 * NO real database — Docker / Mongo / Postgres are not used.
 */

vi.mock("@warlock.js/cascade", () => {
  return {
    transaction: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) => fn({})),
    dataSourceRegistry: { get: vi.fn(() => undefined) },
    migrationRunner: { run: vi.fn(async () => undefined) },
    DatabaseWriterValidationError: class DatabaseWriterValidationError extends Error {},
    // Base class for the seed-records migration file import chain.
    Migration: class Migration {},
  };
});

// Stub the file-discovery surface so importing the action module is side-effect free.
vi.mock("../../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: { load: vi.fn() },
}));
vi.mock("../../../../src/dev-server/path", () => ({
  Path: { toAbsolute: vi.fn(), toRelative: vi.fn() },
}));
vi.mock("../../../../src/dev-server/utils", () => ({
  getFilesFromDirectory: vi.fn(async () => []),
}));
vi.mock("../../../../src/utils", () => ({
  srcPath: vi.fn(() => ""),
}));

import { dropSeedRecords } from "../../../../src/database/seed-command-action";
import { seedRecordsTableName, seedsTableName } from "../../../../src/database/seeds/utils";

/** Seed the fake DB with two seeders' tracked refs + their data rows + log rows. */
function seedFixture(memory: InMemoryDriver) {
  memory.createTable(seedRecordsTableName);
  memory.createTable(seedsTableName);

  // Real data rows the seeders "created".
  memory.driver.insert("roles", { id: 1, name: "admin" });
  memory.driver.insert("roles", { id: 2, name: "member" });
  memory.driver.insert("users", { id: 1, name: "Root" });
  // An untracked row that must survive a drop.
  memory.driver.insert("users", { id: 99, name: "Manually added" });

  // Tracked refs: `roles` seeder ran first (ids 1,2), then `users` seeder (id 1).
  memory.driver.insertMany(seedRecordsTableName, [
    { seeder: "roles", table: "roles", recordId: 1, runAt: new Date() },
    { seeder: "roles", table: "roles", recordId: 2, runAt: new Date() },
    { seeder: "users", table: "users", recordId: 1, runAt: new Date() },
  ]);

  // Seeds-log rows (once-style markers).
  memory.driver.insert(seedsTableName, { name: "roles", runCount: 1 });
  memory.driver.insert(seedsTableName, { name: "users", runCount: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dropSeedRecords", () => {
  it("deletes only tracked records and leaves untracked rows untouched", async () => {
    const memory = createInMemoryDriver();
    seedFixture(memory);
    const datasource = { driver: memory.driver } as any;

    const deleted = await dropSeedRecords(datasource);

    expect(deleted).toBe(3);
    // All tracked role rows gone.
    expect(memory.rowsOf("roles")).toHaveLength(0);
    // Only the tracked user (id 1) is gone; the manually-added id 99 survives.
    expect(memory.rowsOf("users").map((row) => row.id)).toEqual([99]);
  });

  it("clears the seed_records table and resets ALL seeds-log rows", async () => {
    const memory = createInMemoryDriver();
    seedFixture(memory);
    const datasource = { driver: memory.driver } as any;

    await dropSeedRecords(datasource);

    expect(memory.rowsOf(seedRecordsTableName)).toHaveLength(0);
    // Log reset → a once:true seed will re-run on the next `warlock seed`.
    expect(memory.rowsOf(seedsTableName)).toHaveLength(0);
  });

  it("scopes to a single seeder, leaving other seeders' refs + log intact", async () => {
    const memory = createInMemoryDriver();
    seedFixture(memory);
    const datasource = { driver: memory.driver } as any;

    const deleted = await dropSeedRecords(datasource, "roles");

    expect(deleted).toBe(2);
    // roles data + refs + log gone…
    expect(memory.rowsOf("roles")).toHaveLength(0);
    // …but the users seeder is untouched.
    expect(memory.rowsOf("users").map((row) => row.id).sort()).toEqual([1, 99]);
    expect(
      memory.rowsOf(seedRecordsTableName).map((row) => row.seeder),
    ).toEqual(["users"]);
    expect(memory.rowsOf(seedsTableName).map((row) => row.name)).toEqual([
      "users",
    ]);
  });

  it("deletes in reverse insertion (descending id) order", async () => {
    const memory = createInMemoryDriver();
    seedFixture(memory);
    const datasource = { driver: memory.driver } as any;

    await dropSeedRecords(datasource);

    // The last deleteMany on seed_records / seeds aside, the per-record deletes
    // should have targeted the highest seed_records id first.
    const recordDeletes = memory.driver.deleteMany.mock.calls.filter(
      ([table]) => table === "users" || table === "roles",
    );

    // users(recordId 1) was the last-inserted ref → deleted first.
    expect(recordDeletes[0]).toEqual(["users", { id: 1 }]);
    // then roles id 2, then roles id 1.
    expect(recordDeletes[1]).toEqual(["roles", { id: 2 }]);
    expect(recordDeletes[2]).toEqual(["roles", { id: 1 }]);
  });

  it("returns 0 when the seed_records table does not exist", async () => {
    const memory = createInMemoryDriver();
    const datasource = { driver: memory.driver } as any;

    const deleted = await dropSeedRecords(datasource);

    expect(deleted).toBe(0);
  });

  it("returns 0 when there are no tracked records", async () => {
    const memory = createInMemoryDriver();
    memory.createTable(seedRecordsTableName);
    const datasource = { driver: memory.driver } as any;

    const deleted = await dropSeedRecords(datasource);

    expect(deleted).toBe(0);
  });
});
