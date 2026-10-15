import { describe, expect, it } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import { SQLSerializer } from "../../../src/migration/sql-serializer";

/**
 * Regression: a `withConnection` backfill ran immediately during `up()`, i.e.
 * BEFORE the schema statements queued ahead of it (ADD COLUMN → backfill →
 * SET NOT NULL executed as backfill → ADD COLUMN → SET NOT NULL).
 */

class RawSerializer extends SQLSerializer {
  serialize(operation: { payload: unknown }): string {
    return operation.payload as string;
  }
}

class BackfillPhone extends Migration {
  public readonly table = "users";

  public constructor(private readonly log: string[]) {
    super();
  }

  public async up(): Promise<void> {
    this.raw('ALTER TABLE "users" ADD COLUMN "phone" text');
    await this.withConnection(async () => {
      this.log.push("backfill");
    });
    this.raw('ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL');
  }

  public async down(): Promise<void> {}
}

const bind = (log: string[]) => {
  const migration = new BackfillPhone(log);
  migration.setDriver({
    driver: { getSQLSerializer: () => new RawSerializer() },
    raw: async (callback: (connection: unknown) => Promise<unknown>) => callback({}),
  } as any);
  return migration;
};

describe("Migration data steps — authored order", () => {
  it("runs the backfill after ADD COLUMN and before SET NOT NULL", async () => {
    const executed: string[] = [];
    const migration = bind(executed);

    await migration.up();

    for (const step of migration.toSteps()) {
      if (typeof step === "string") executed.push(step);
      else await step.data();
    }

    expect(executed).toEqual([
      'ALTER TABLE "users" ADD COLUMN "phone" text',
      "backfill",
      'ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL',
    ]);
  });

  it("MigrationRunner.runAll executes the steps in authored order", async () => {
    const executed: string[] = [];
    const migration = bind(executed);
    const Cls = { migrationName: "backfill-phone", createdAt: "01-01-2026_10-00-00" };

    const driver = {
      supportsSqlSerialization: true,
      migrationDriver: () => ({ getDefaultTransactional: () => false }),
      query: async (sql: string) => {
        executed.push(sql);
      },
    };

    const runner = new MigrationRunner({ verbose: false }) as any;
    runner.getDataSource = () => ({ driver });
    runner.getPendingMigrations = async () => [Cls];
    runner.getNextBatchNumber = async () => 1;
    runner.recordMigration = async () => undefined;
    runner.informIfExtensionMissing = async () => undefined;
    runner.createMigrationInstance = () => {
      migration.setMigrationDefaults = () => undefined;
      migration.setDriver = () => undefined;
      return migration;
    };

    await runner.runAll();

    expect(executed).toEqual([
      'ALTER TABLE "users" ADD COLUMN "phone" text',
      "backfill",
      'ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL',
    ]);
  });

  it("dry run performs no writes and lists the data step as a comment", async () => {
    const executed: string[] = [];
    const migration = bind(executed);
    migration.setDryRun(true);

    await migration.up();

    expect(migration.toSQL()).toEqual([
      'ALTER TABLE "users" ADD COLUMN "phone" text',
      "-- data step (withConnection) skipped",
      'ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL',
    ]);
    expect(executed).toEqual([]);
  });
});
