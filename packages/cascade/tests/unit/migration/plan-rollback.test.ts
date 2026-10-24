import { describe, expect, it, vi } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { text } from "../../../src/migration/column-helpers";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import { MongoMigrationDriver } from "../../../src/drivers/mongodb/mongodb-migration-driver";
import { createTestModelClass } from "../../utils/test-helpers";

const User = createTestModelClass("User", { table: "users" }) as any;

function documentSource(counts: { withField?: number; all?: number }) {
  const migrationDriver: any = {
    ensureMigrationsTable: async () => undefined,
    tableExists: async () => true,
    getDefaultTransactional: () => false,
    countRows: async () => counts.all,
    countWithColumns: async () => counts.withField,
  };
  const driver: any = {
    name: "mongodb",
    supportsSqlSerialization: false,
    queryBuilder: () => {
      const qb: any = {
        orderBy: () => qb,
        get: async () => [
          { name: "mirrored", batch: 1 },
          { name: "add-only", batch: 1 },
        ],
      };
      return qb;
    },
    migrationDriver: () => migrationDriver,
  };

  migrationDriver.driver = driver;

  return { driver, migrationDefaults: undefined, migrations: undefined } as any;
}

const named = (name: string, Class: any) => {
  Class.migrationName = name;
  return Class;
};

describe("MigrationRunner.planRollback", () => {
  it("reports unset fields with counts and skips ledger-only alters", async () => {
    const runner = new MigrationRunner({
      dataSource: documentSource({ withField: 7 }),
      verbose: false,
    });
    runner.register(
      named(
        "mirrored",
        Migration.alter(
          User,
          { add: { phone: text() } },
          {
            down() {
              this.dropColumn("phone", { destructive: true });
            },
          },
        ),
      ),
    );
    runner.register(named("add-only", Migration.alter(User, { add: { phone: text() } })));

    const plan = await runner.planRollback(1);
    const byName = Object.fromEntries(plan.map((entry) => [entry.name, entry.operations]));

    expect(byName["mirrored"]).toEqual([
      {
        type: "dropFields",
        table: "users",
        store: "document",
        fields: ["phone"],
        applied: true,
        count: 7,
      },
    ]);
    expect(byName["add-only"]).toEqual([]);
  });

  it("makes no writes while planning", async () => {
    const source = documentSource({});
    const insert = vi.fn();
    source.driver.insert = insert;
    source.driver.delete = insert;
    const runner = new MigrationRunner({ dataSource: source, verbose: false });
    runner.register(named("mirrored", Migration.alter(User, { add: { phone: text() } })));
    runner.register(named("add-only", Migration.alter(User, { add: { phone: text() } })));

    await runner.planRollback(1);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("MongoMigrationDriver counts", () => {
  function driverWith(countDocuments: ReturnType<typeof vi.fn>) {
    const db = { collection: vi.fn(() => ({ countDocuments })) };
    return new MongoMigrationDriver({ getDatabase: () => db } as any);
  }

  it("counts documents that hold any of the fields", async () => {
    const countDocuments = vi.fn().mockResolvedValue(3);
    const driver = driverWith(countDocuments);

    await expect(driver.countWithColumns("users", ["a", "b"])).resolves.toBe(3);
    expect(countDocuments).toHaveBeenCalledWith({
      $or: [{ a: { $exists: true } }, { b: { $exists: true } }],
    });
  });

  it("counts every document for a collection drop", async () => {
    const countDocuments = vi.fn().mockResolvedValue(9);

    await expect(driverWith(countDocuments).countRows("users")).resolves.toBe(9);
    expect(countDocuments).toHaveBeenCalledWith({});
  });
});
