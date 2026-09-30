import { log } from "@warlock.js/logger";
import { describe, expect, it, vi } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { createTestModelClass } from "../../utils/test-helpers";

function mongoDriver(createIndex = vi.fn().mockResolvedValue(undefined)) {
  return {
    driver: { name: "mongodb" },
    createIndex,
  } as any;
}

describe("migration index name collisions", () => {
  it("rejects colliding MongoDB generated names before calling the driver", async () => {
    const Migration_ = Migration.alter(
      createTestModelClass("User", { table: "users" }) as any,
      { addIndex: [{ columns: "user_id" }] },
      {
        up() {
          (this as any).pendingOperations.push({
            type: "createIndex",
            payload: { columns: ["user_id"], unique: true, where: { active: true } },
          });
        },
      },
    );
    const migration = new Migration_();
    const driver = mongoDriver();
    migration.setDriver(driver);

    await migration.up();

    await expect(migration.execute()).rejects.toThrow(
      /generated name "user_id_1".*columns \[user_id\].*unique: false.*unique: true.*partial: {"active":true}.*name/i,
    );
    expect(driver.createIndex).not.toHaveBeenCalled();
  });

  it("preserves unnamed non-colliding index definitions", async () => {
    const Migration_ = Migration.alter(createTestModelClass("User", { table: "users" }) as any, {
      addIndex: [{ columns: "user_id" }, { columns: "account_id" }],
    });
    const migration = new Migration_();
    const driver = mongoDriver();
    migration.setDriver(driver);

    await migration.up();
    await migration.execute();

    expect(driver.createIndex).toHaveBeenCalledTimes(2);
    expect(driver.createIndex).toHaveBeenNthCalledWith(1, "users", {
      columns: ["user_id"],
      name: undefined,
      include: undefined,
      concurrently: undefined,
    });
    expect(driver.createIndex).toHaveBeenNthCalledWith(2, "users", {
      columns: ["account_id"],
      name: undefined,
      include: undefined,
      concurrently: undefined,
    });
  });

  it("allows colliding definitions when they are explicitly named", async () => {
    const Migration_ = Migration.alter(
      createTestModelClass("User", { table: "users" }) as any,
      { addIndex: [{ columns: "user_id", name: "user_id_index" }] },
      {
        up() {
          (this as any).pendingOperations.push({
            type: "createIndex",
            payload: {
              columns: ["user_id"],
              name: "active_user_id_unique",
              unique: true,
              where: { active: true },
            },
          });
        },
      },
    );
    const migration = new Migration_();
    const driver = mongoDriver();
    migration.setDriver(driver);

    await migration.up();
    await migration.execute();

    expect(driver.createIndex).toHaveBeenCalledTimes(2);
  });

  it("warns once when a declarative alter has custom up() but no down()", async () => {
    const Migration_ = Migration.alter(
      createTestModelClass("User", { table: "users" }) as any,
      {},
      { up() {} },
    ) as any;
    Migration_.migrationName = "20260930_custom_up";
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as any);

    try {
      const migration = new Migration_();
      await migration.up();
      await migration.up();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "database",
        "migration",
        expect.stringContaining("20260930_custom_up"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
