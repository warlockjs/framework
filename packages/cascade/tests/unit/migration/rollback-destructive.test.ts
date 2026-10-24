import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { text } from "../../../src/migration/column-helpers";
import { createTestModelClass } from "../../utils/test-helpers";

const User = createTestModelClass("User", { table: "users" }) as any;

function documentDriver() {
  return {
    driver: { name: "mongodb", supportsSqlSerialization: false },
    addColumn: vi.fn().mockResolvedValue(undefined),
    dropColumn: vi.fn().mockResolvedValue(undefined),
    dropColumns: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function sqlDriver() {
  return {
    driver: { name: "postgres", supportsSqlSerialization: true },
    dropColumn: vi.fn().mockResolvedValue(undefined),
  } as any;
}

async function rollback(MigrationClass: any, driver: any) {
  const migration = new MigrationClass();
  migration.setDriver(driver);
  migration.setDirection("down");
  await migration.down();

  return migration;
}

afterEach(() => vi.restoreAllMocks());

describe("add-only alter auto-derived down()", () => {
  const AddOnly = () => Migration.alter(User, { add: { phone: text().nullable() } });

  it("is a ledger-only no-op on a document store", async () => {
    const driver = documentDriver();
    const migration = await rollback(AddOnly(), driver);

    expect(migration.describeDestructiveOperations()).toEqual([]);
    await migration.execute();
    expect(driver.dropColumn).not.toHaveBeenCalled();
    expect(driver.dropColumns).not.toHaveBeenCalled();
  });

  it("drops the added columns on SQL", async () => {
    const migration = await rollback(AddOnly(), sqlDriver());

    expect(migration.describeDestructiveOperations()).toEqual([
      { type: "dropFields", table: "users", store: "sql", fields: ["phone"], applied: true },
    ]);
  });

  it("does not warn about a missing down()", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as any);
    const migration = new (AddOnly())();
    migration.setDriver(documentDriver());

    await migration.up();

    expect(warn).not.toHaveBeenCalled();
  });

  it("derives nothing when the alter does more than add", async () => {
    const Mixed = Migration.alter(User, { add: { phone: text() }, drop: ["legacy"] });
    const migration = await rollback(Mixed, sqlDriver());

    expect(migration.describeDestructiveOperations()).toEqual([]);
  });

  it("still warns for a custom up() without down()", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as any);
    const Custom = Migration.alter(User, { add: { phone: text() } }, { up() {} });
    const migration = new Custom();
    migration.setDriver(documentDriver());

    await migration.up();

    expect(warn).toHaveBeenCalledOnce();
  });

  it("prefers an explicit down()", async () => {
    const Explicit = Migration.alter(
      User,
      { add: { phone: text() } },
      {
        down() {
          this.dropColumn("phone", { destructive: true });
        },
      },
    );
    const driver = documentDriver();
    const migration = await rollback(Explicit, driver);
    await migration.execute();

    expect(driver.dropColumn).toHaveBeenCalledWith("users", "phone");
  });
});

describe("dropColumn inside a document-store rollback", () => {
  const Mirrored = () =>
    Migration.alter(
      User,
      { add: { phone: text() } },
      {
        down() {
          this.dropColumn("phone");
        },
      },
    );

  it("skips a plain drop and warns", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as any);
    const driver = documentDriver();
    const migration = await rollback(Mirrored(), driver);

    expect(migration.describeDestructiveOperations()).toEqual([
      { type: "dropFields", table: "users", store: "document", fields: ["phone"], applied: false },
    ]);

    await migration.execute();

    expect(driver.dropColumn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("unsets the field with destructive: true", async () => {
    const Destructive = Migration.alter(
      User,
      { add: { phone: text() } },
      {
        down() {
          this.dropColumn("phone", { destructive: true });
        },
      },
    );
    const driver = documentDriver();
    const migration = await rollback(Destructive, driver);

    expect(migration.describeDestructiveOperations()[0]).toMatchObject({ applied: true });

    await migration.execute();

    expect(driver.dropColumn).toHaveBeenCalledWith("users", "phone");
  });

  it("skips dropColumns() the same way", async () => {
    const Many = Migration.alter(User, {}, {
      down() {
        this.dropColumns("a", "b");
      },
    });
    const driver = documentDriver();
    const migration = await rollback(Many, driver);
    vi.spyOn(log, "warn").mockImplementation(() => undefined as any);

    await migration.execute();

    expect(driver.dropColumns).not.toHaveBeenCalled();
  });

  it("applies the drop on SQL without the opt-in", async () => {
    const driver = sqlDriver();
    const migration = await rollback(Mirrored(), driver);

    expect(migration.describeDestructiveOperations()[0]).toMatchObject({ applied: true });
  });

  it("keeps forward drops working", async () => {
    const Forward = Migration.alter(User, { drop: ["legacy"] });
    const driver = documentDriver();
    const migration = new Forward();
    migration.setDriver(driver);
    migration.setDirection("up");

    await migration.up();
    await migration.execute();

    expect(driver.dropColumn).toHaveBeenCalledWith("users", "legacy");
  });

  it("reports table drops as destructive", async () => {
    const Created = Migration.create(User, { name: text() });
    const migration = await rollback(Created, documentDriver());

    expect(migration.describeDestructiveOperations()).toEqual([
      { type: "dropTable", table: "users", store: "document", applied: true },
    ]);
  });
});
