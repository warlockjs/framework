import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/**
 * K2 B7 / B11 / B12 / B13: dry runs write nothing, driver errors are not
 * swallowed, orphaned rollback rows fail loudly, duplicate names throw.
 */
const makeSource = (opts: { executed?: any[]; failRead?: boolean; log?: string[] } = {}) => {
  const log = opts.log ?? [];
  const driver: any = {
    supportsSqlSerialization: true,
    query: async (sql: string) => void log.push(`query:${sql}`),
    transaction: async (fn: () => Promise<void>) => fn(),
    insert: async () => void log.push("insert"),
    delete: async (_t: string, where: { name: string }) => void log.push(`delete:${where.name}`),
    queryBuilder: () => {
      const qb: any = {
        orderBy: () => qb,
        get: async () => {
          if (opts.failRead) throw new Error("connection refused");
          return opts.executed ?? [];
        },
      };
      return qb;
    },
    migrationDriver: () => ({
      ensureMigrationsTable: async () => void log.push("ensure-table"),
      tableExists: async () => false,
      getDefaultTransactional: () => true,
      isExtensionAvailable: async () => true,
    }),
  };
  return { driver, migrationDefaults: undefined, migrations: undefined } as any;
};

const migration = (name: string, log: string[] = []) => {
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
      if (!this.dry) log.push(`side-effect:${name}`);
    }
    public toSQL() {
      return [`SELECT '${name}'`];
    }
  }
  return M as any;
};

describe("MigrationRunner K2 sweep", () => {
  it("B7: a dry run performs no writes and does not create the migrations table", async () => {
    const log: string[] = [];
    const runner = new MigrationRunner({ dataSource: makeSource({ log }), verbose: false });
    runner.register(migration("a", log));

    await runner.runAll({ dryRun: true });

    expect(log).toEqual([]);
  });

  it("B11: a failing read of the migrations table is not reported as 'nothing executed'", async () => {
    const runner = new MigrationRunner({
      dataSource: makeSource({ failRead: true }),
      verbose: false,
    });

    await expect(runner.getExecutedMigrations()).rejects.toThrow("connection refused");
  });

  it("B12: rollback fails loudly on a record with no file, and prunes with pruneMissing", async () => {
    const log: string[] = [];
    const source = makeSource({ log, executed: [{ name: "gone", batch: 1 }] });
    const runner = new MigrationRunner({ dataSource: source, verbose: false });

    await expect(runner.rollbackLast()).rejects.toThrow(/gone/);

    await runner.rollbackLast({ pruneMissing: true });
    expect(log).toContain("delete:gone");
  });

  it("B13: two different classes with the same name throw", () => {
    const runner = new MigrationRunner({ dataSource: makeSource(), verbose: false });
    const first = migration("create");
    runner.register(first);

    expect(() => runner.register(first)).not.toThrow();
    expect(() => runner.register(migration("create"))).toThrow(/Duplicate migration name "create"/);
  });
});
