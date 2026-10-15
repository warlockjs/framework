import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/**
 * Two concurrent `runAll()` calls (replicas / init containers) on one Postgres
 * data source: the second must wait on the session advisory lock, and by the
 * time it gets it the winner has recorded the migration, so it runs once.
 */
const makePgSource = () => {
  const events: string[] = [];
  const executed: { name: string; batch: number }[] = [];

  // Model of `pg_advisory_lock`: one holder at a time, others queue.
  let held = false;
  const waiters: Array<() => void> = [];
  const acquire = async () => {
    if (!held) {
      held = true;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else held = false;
  };

  const makeClient = (id: number) => ({
    query: async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        events.push(`unlock:${id}`);
        release();
        return;
      }
      events.push(`lock-requested:${id}`);
      await acquire();
      events.push(`lock-acquired:${id}`);
    },
    release: () => void events.push(`client-released:${id}`),
  });

  let clients = 0;
  const driver: any = {
    name: "postgres",
    supportsSqlSerialization: true,
    getClient: () => ({ connect: async () => makeClient(++clients) }),
    query: async (sql: string) => {
      events.push(`query:${sql}`);
      // the winner's work takes a few ticks, so a lock-less second run would overlap
      await new Promise((r) => setTimeout(r, 10));
    },
    transaction: async (fn: () => Promise<void>) => fn(),
    insert: async (_t: string, row: { name: string; batch: number }) => {
      executed.push(row);
    },
    delete: async () => {},
    queryBuilder: () => {
      const qb: any = {
        orderBy: () => qb,
        get: async () => [...executed],
      };
      return qb;
    },
    migrationDriver: () => ({
      ensureMigrationsTable: async () => {},
      tableExists: async () => true,
      getDefaultTransactional: () => true,
      isExtensionAvailable: async () => true,
    }),
  };

  return { source: { driver, migrationDefaults: undefined, migrations: undefined } as any, events };
};

const migration = (name: string) => {
  class M {
    public static migrationName = name;
    public table = name;
    public setDriver() {}
    public setMigrationDefaults() {}
    public setDryRun() {}
    public async up() {}
    public toSQL() {
      return [`SELECT '${name}'`];
    }
  }
  return M as any;
};

describe("migration advisory lock", () => {
  it("serializes two concurrent runAll() calls and runs the migration once", async () => {
    const { source, events } = makePgSource();
    const build = () => {
      const runner = new MigrationRunner({ dataSource: source, verbose: false });
      runner.register(migration("create_users"));
      return runner;
    };

    await Promise.all([build().runAll(), build().runAll()]);

    // the migration's SQL ran exactly once
    expect(events.filter((e) => e === "query:SELECT 'create_users'")).toHaveLength(1);

    // both requested the lock, the second only acquired it after the first unlocked
    expect(events.filter((e) => e.startsWith("lock-requested"))).toHaveLength(2);
    expect(events.indexOf("lock-acquired:2")).toBeGreaterThan(events.indexOf("unlock:1"));

    // the lock lives on a dedicated client, returned to the pool afterwards
    expect(events).toContain("client-released:1");
    expect(events).toContain("client-released:2");
  });
});
