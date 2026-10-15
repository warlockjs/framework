import { describe, expect, it } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { createTestModelClass } from "../../utils/test-helpers";

/**
 * `foreignId(name)` must create a column whose TYPE tracks the DataSource's
 * default primary key (`migrationDefaults.primaryKey`), so a plain FK id column
 * (e.g. a polymorphic `user_id`) is always type-compatible with the id it
 * holds. Hardcoding `uuid` here 500'd every login on a default integer-PK app
 * (finding 5e47bdb3): an integer id written into a uuid column throws at
 * insert. This gate fails if `foreignId` stops tracking the configured PK type.
 */
function foreignIdColumnType(primaryKey: "uuid" | "int" | "bigInt" | undefined): string | undefined {
  const model = createTestModelClass("ForeignIdTest", { table: "foreign_id_test" });
  const MigrationClass = Migration.create(model as any, {});
  const migration = new MigrationClass() as any;

  // Exercise the resolution the auto primary key uses, without a driver.
  migration._migrationDefaults = primaryKey === undefined ? undefined : { primaryKey };
  migration.foreignId("user_id");

  const columns = (migration.pendingOperations as { type: string; payload: { name: string; type: string } }[])
    .filter((op) => op.type === "addColumn")
    .map((op) => op.payload);

  return columns.find((column) => column.name === "user_id")?.type;
}

describe("Migration.foreignId — tracks the default primary-key type (5e47bdb3)", () => {
  it("defaults to an integer column (matching the framework default PK)", () => {
    expect(foreignIdColumnType(undefined)).toBe("integer");
  });

  it("is an integer column when migrationDefaults.primaryKey is 'int'", () => {
    expect(foreignIdColumnType("int")).toBe("integer");
  });

  it("is a uuid column when migrationDefaults.primaryKey is 'uuid'", () => {
    expect(foreignIdColumnType("uuid")).toBe("uuid");
  });

  it("is a bigInteger column when migrationDefaults.primaryKey is 'bigInt'", () => {
    expect(foreignIdColumnType("bigInt")).toBe("bigInteger");
  });
});
