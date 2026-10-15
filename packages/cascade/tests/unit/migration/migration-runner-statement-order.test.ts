import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../../src/migration/migration-runner";

/**
 * Regression: `runAll()` used to pool statements from every pending migration
 * and phase-sort them globally, so migration B's backfill / SET NOT NULL could
 * run before migration A's ADD COLUMN.
 */

const fakeMigration = (name: string, createdAt: string, statements: string[]) => ({
  migrationName: name,
  createdAt,
  statements,
});

describe("MigrationRunner.runAll — statement order", () => {
  it("executes migration A's statements, then B's (backfill before set NOT NULL)", async () => {
    const executed: string[] = [];
    const A = fakeMigration("add-phone", "01-01-2026_10-00-00", [
      'ALTER TABLE "users" ADD COLUMN "phone" text',
    ]);
    const B = fakeMigration("backfill-phone", "02-01-2026_10-00-00", [
      "UPDATE \"users\" SET \"phone\" = ''",
      'ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL',
    ]);

    const driver = {
      supportsSqlSerialization: true,
      migrationDriver: () => ({ getDefaultTransactional: () => false }),
      query: async (sql: string) => {
        executed.push(sql);
      },
    };

    const runner = new MigrationRunner({ verbose: false }) as any;
    runner.getDataSource = () => ({ driver });
    runner.getPendingMigrations = async () => [A, B];
    runner.getNextBatchNumber = async () => 1;
    runner.recordMigration = async () => undefined;
    runner.informIfExtensionMissing = async () => undefined;
    runner.createMigrationInstance = (cls: typeof A) => ({
      table: "users",
      setDriver: () => undefined,
      setMigrationDefaults: () => undefined,
      up: async () => undefined,
      toSQL: () => cls.statements,
    });

    await runner.runAll();

    expect(executed).toEqual([...A.statements, ...B.statements]);
  });
});
