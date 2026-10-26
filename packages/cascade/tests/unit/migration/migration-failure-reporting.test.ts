import { afterEach, describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import { StepTimeoutError, withTimeout } from "../../../src/utils/with-timeout";

/**
 * A direct-execution (MongoDB-like) data source: no SQL, no transaction, the
 * migration applies its own steps and the runner records a ledger row afterwards.
 */
const makeDirectSource = () => {
  const ledger: { name: string; batch: number }[] = [];

  const driver: any = {
    name: "direct",
    supportsSqlSerialization: false,
    insert: async (_table: string, row: { name: string; batch: number }) => {
      ledger.push(row);
    },
    delete: async () => {},
    queryBuilder: () => {
      const qb: any = { orderBy: () => qb, get: async () => [...ledger] };
      return qb;
    },
    migrationDriver: () => ({
      ensureMigrationsTable: async () => {},
      tableExists: async () => true,
      getDefaultTransactional: () => false,
    }),
  };

  return { source: { driver, migrationDefaults: undefined } as any, ledger };
};

const migration = (name: string, execute: () => Promise<void>) => {
  class M {
    public static migrationName = name;
    public table = name;
    public setDriver() {}
    public setMigrationDefaults() {}
    public setDirection() {}
    public setDryRun() {}
    public async up() {}
    public async down() {}
    public execute = execute;
  }

  return M as any;
};

describe("migration failure reporting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the migration, writes no ledger row and says how to recover after a partial failure", async () => {
    const { source, ledger } = makeDirectSource();
    const runner = new MigrationRunner({ dataSource: source, verbose: false });

    runner.register(
      migration("add_indexes", async () => {
        throw Object.assign(new Error("index build failed (step 3 of 5)"), { appliedSteps: 2 });
      }),
    );

    const error = await runner.runAll().then(
      () => undefined,
      (failure: Error) => failure,
    );

    expect(error?.message).toContain('Migration "add_indexes" failed: index build failed');
    expect(error?.message).toContain("No ledger row was written");
    expect(error?.message).toContain("2 of its steps were applied");
    expect(error?.message).toContain("idempotent");
    expect(ledger).toEqual([]);
  });

  it("fails a migration that does not finish within the bound instead of hanging", async () => {
    const { source, ledger } = makeDirectSource();
    const runner = new MigrationRunner({ dataSource: source, verbose: false, stepTimeoutMs: 30 });

    runner.register(migration("stuck", () => new Promise<void>(() => {})));

    const error = await runner.runAll().then(
      () => undefined,
      (failure: Error) => failure,
    );

    expect(error?.cause).toBeInstanceOf(StepTimeoutError);
    expect(error?.message).toContain('Migration "stuck" (up) did not finish within');
    expect(error?.message).toContain("No ledger row was written");
    expect(ledger).toEqual([]);
  });

  it("leaves a migration that finishes in time untouched and records it", async () => {
    const { source, ledger } = makeDirectSource();
    const runner = new MigrationRunner({ dataSource: source, verbose: false, stepTimeoutMs: 1000 });

    runner.register(migration("quick", async () => {}));

    await runner.runAll();

    expect(ledger.map((row) => row.name)).toEqual(["quick"]);
  });

  it("reads the bound from the environment and lets 0 disable it", () => {
    vi.stubEnv("WARLOCK_MIGRATION_TIMEOUT_MS", "1500");
    expect(new MigrationRunner({ verbose: false }).getStepTimeout()).toBe(1500);

    vi.stubEnv("WARLOCK_MIGRATION_TIMEOUT_MS", "0");
    expect(new MigrationRunner({ verbose: false }).getStepTimeout()).toBe(0);

    vi.unstubAllEnvs();
  });
});

describe("withTimeout", () => {
  it("passes the value through and clears its timer", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, () => "late")).resolves.toBe(7);
  });

  it("is a no-op for a zero bound", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 0, () => "late")).resolves.toBe("ok");
  });

  it("rejects with the description when the step stalls", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, () => "stalled")).rejects.toThrow(
      "stalled",
    );
  });
});
