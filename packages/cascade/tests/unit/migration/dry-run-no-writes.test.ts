import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/** Every driver / migration-driver method that mutates the database. */
const writeMethods = [
  "query",
  "insert",
  "insertMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "replace",
  "upsert",
  "transaction",
  "beginTransaction",
  "commit",
  "rollback",
];
const migrationDriverWrites = [
  "ensureMigrationsTable",
  "createTable",
  "dropTable",
  "createExtension",
  "acquireLock",
];

const makeSource = () => {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const driver: any = {
    name: "postgres",
    supportsSqlSerialization: true,
    // a lock needs a client; a dry run must never ask for one
    getClient: vi.fn(() => {
      throw new Error("dry run must not connect for a lock");
    }),
    queryBuilder: () => {
      const qb: any = { orderBy: () => qb, get: async () => [] };
      return qb;
    },
  };

  for (const method of writeMethods) {
    spies[`driver.${method}`] = driver[method] = vi.fn(async () => {
      throw new Error(`write method called: ${method}`);
    });
  }

  const migrationDriver: any = {
    tableExists: async () => false,
    getDefaultTransactional: () => true,
    isExtensionAvailable: async () => true,
  };
  for (const method of migrationDriverWrites) {
    spies[`migrationDriver.${method}`] = migrationDriver[method] = vi.fn(async () => {
      throw new Error(`write method called: ${method}`);
    });
  }
  driver.migrationDriver = () => migrationDriver;

  return { source: { driver, migrationDefaults: undefined, migrations: undefined } as any, spies };
};

const migration = (name: string, sideEffects: string[]) => {
  class M {
    public static migrationName = name;
    public table = name;
    private dry = false;
    public setDriver() {}
    public setMigrationDefaults() {}
    public setDryRun(flag: boolean) {
      this.dry = flag;
    }
    public async up() {
      if (!this.dry) sideEffects.push(`up:${name}`);
    }
    public async down() {}
    public toSQL() {
      return [`CREATE TABLE ${name} (id int)`];
    }
  }
  return M as any;
};

const expectNoWrites = (spies: Record<string, ReturnType<typeof vi.fn>>) => {
  for (const [name, spy] of Object.entries(spies)) {
    expect(spy, name).not.toHaveBeenCalled();
  }
};

describe("dry run / SQL export perform no writes", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dry-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("runAll({ dryRun: true }) calls no write method and takes no lock", async () => {
    const { source, spies } = makeSource();
    const sideEffects: string[] = [];
    const runner = new MigrationRunner({ dataSource: source, verbose: false });
    runner.register(migration("a", sideEffects));

    await runner.runAll({ dryRun: true });

    expectNoWrites(spies);
    expect(source.driver.getClient).not.toHaveBeenCalled();
    expect(sideEffects).toEqual([]);
  });

  it("exportSQL (--sql) calls no driver write method, only writes the .sql files", async () => {
    const { source, spies } = makeSource();
    const sideEffects: string[] = [];
    const runner = new MigrationRunner({ dataSource: source, verbose: false });
    runner.register(migration("a", sideEffects));

    await runner.exportSQL();

    expectNoWrites(spies);
    expect(sideEffects).toEqual([]);
    const files = fs.readdirSync(path.join(tmp, "database", "sql"));
    expect(files.some((f) => f.endsWith(".up.sql"))).toBe(true);
  });

  it("exportSQL({ pendingOnly }) reads pending state without creating the migrations table", async () => {
    const { source, spies } = makeSource();
    const runner = new MigrationRunner({ dataSource: source, verbose: false });
    runner.register(migration("a", []));

    await runner.exportSQL({ pendingOnly: true });

    expectNoWrites(spies);
  });
});
