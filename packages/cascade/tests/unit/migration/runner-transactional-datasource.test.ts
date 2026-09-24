import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/**
 * K2 B2 / B3: `transactional: false` must skip begin/commit, and a migration's
 * declared `dataSource` must run on that driver and be recorded in its table.
 */
const makeSource = (label: string, log: string[]) => {
  const driver: any = {
    supportsSqlSerialization: true,
    query: async (sql: string) => void log.push(`${label}:query:${sql}`),
    transaction: async (fn: () => Promise<void>) => {
      log.push(`${label}:begin`);
      await fn();
      log.push(`${label}:commit`);
    },
    insert: async (table: string, row: { name: string }) =>
      void log.push(`${label}:record:${table}:${row.name}`),
    delete: async () => undefined,
    queryBuilder: () => {
      const qb: any = { orderBy: () => qb, get: async () => [] };
      return qb;
    },
    migrationDriver: () => ({
      ensureMigrationsTable: async () => undefined,
      getDefaultTransactional: () => true,
      isExtensionAvailable: async () => true,
    }),
  };
  return { driver, migrationDefaults: undefined, migrations: undefined } as any;
};

const migration = (name: string, extra: Record<string, unknown>) => {
  class M {
    public static migrationName = name;
    public table = name;
    // No `dataSource` / `transactional` class fields: they would define own
    // properties (undefined) that shadow the prototype values assigned below.
    public setDriver() {}
    public setMigrationDefaults() {}
    public async up() {}
    public toSQL() {
      return [`SELECT '${name}'`];
    }
  }
  Object.assign(M.prototype, extra);
  return M as any;
};

describe("MigrationRunner transactional + dataSource", () => {
  it("does not wrap a transactional:false migration in begin/commit", async () => {
    const log: string[] = [];
    const runner = new MigrationRunner({ dataSource: makeSource("pg", log), verbose: false });
    runner.register(migration("a-plain", { transactional: false }));

    await runner.runAll();

    expect(log).not.toContain("pg:begin");
    expect(log).toContain("pg:query:SELECT 'a-plain'");
  });

  it("runs a migration declaring dataSource 'analytics' on that driver", async () => {
    const log: string[] = [];
    const analytics = makeSource("analytics", log);
    const runner = new MigrationRunner({ dataSource: makeSource("pg", log), verbose: false });
    const { dataSourceRegistry } = await import("../../../src/data-source/data-source-registry");
    const original = dataSourceRegistry.get.bind(dataSourceRegistry);
    dataSourceRegistry.get = ((name?: string) =>
      name === "analytics" ? analytics : original(name)) as any;

    try {
      runner.register(migration("b-events", { dataSource: "analytics" }));
      await runner.runAll();
    } finally {
      dataSourceRegistry.get = original;
    }

    expect(log).toContain("analytics:query:SELECT 'b-events'");
    expect(log).toContain("analytics:record:_migrations:b-events");
    expect(log.some((entry) => entry.startsWith("pg:"))).toBe(false);
  });
});
