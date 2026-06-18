import { describe, expect, it } from "vitest";
import { dateTime, string } from "../../../src/migration/column-helpers";
import { Migration } from "../../../src/migration/migration";
import { Model } from "../../../src/model/model";
import type { DeleteStrategy } from "../../../src/types";
import {
  createMockDataSource,
  createTestModelClass,
} from "../../utils/test-helpers";

/**
 * Build a plain Model subclass WITHOUT mocking `getDataSource`, so the resolver
 * exercises its real `getDataSource()` call (and the catch fallback when no data
 * source is registered). Strategy comes from the model static set here.
 */
function makeModel(
  config: {
    deleteStrategy?: DeleteStrategy;
    deletedAtColumn?: string | false;
  } = {},
) {
  class TestModel extends Model {
    public static table = "soft_delete_test";
    public static deleteStrategy = config.deleteStrategy;
    public static deletedAtColumn = (config.deletedAtColumn ?? "deletedAt") as
      | string
      | false;
  }

  return TestModel;
}

/**
 * Run a declarative migration's `up()` and return the queued `addColumn`
 * definitions. `up()` only queues operations (no driver access), so no driver
 * needs to be injected.
 */
async function addedColumns(
  ctor: any,
): Promise<Array<{ name: string; type: string; nullable?: boolean }>> {
  const migration = new ctor();
  await migration.up();
  const ops = (migration as any).pendingOperations as {
    type: string;
    payload: any;
  }[];
  return ops.filter((op) => op.type === "addColumn").map((op) => op.payload);
}

function find(columns: Array<{ name: string }>, name: string) {
  return columns.find((column) => column.name === name);
}

describe("Migration.create — soft-delete auto-wiring", () => {
  it("wires the deletedAt column when the model strategy is soft", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "soft" }) as any,
      {
        title: string(),
      },
    );

    const columns = await addedColumns(Migration_);
    const deletedAt = find(columns, "deletedAt");

    expect(deletedAt).toBeDefined();
    expect(deletedAt?.type).toBe("dateTime");
    expect(deletedAt?.nullable).toBe(true);
  });

  it("does not wire the column when the strategy is permanent", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "permanent" }) as any,
      {
        title: string(),
      },
    );

    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeUndefined();
  });

  it("does not wire the column when no strategy resolves to soft", async () => {
    // Mocked data source with no defaultDeleteStrategy → resolves to "permanent".
    const model = createTestModelClass("NoStrategy", { table: "no_strategy" });

    const Migration_ = Migration.create(model as any, { title: string() });
    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeUndefined();
  });

  it("wires the column from the data source defaultDeleteStrategy", async () => {
    const dataSource = createMockDataSource({ defaultDeleteStrategy: "soft" });
    // Model has no static strategy — it must come from the data source default.
    const model = createTestModelClass(
      "FromDataSource",
      { table: "from_ds" },
      dataSource,
    );

    const Migration_ = Migration.create(model as any, { title: string() });
    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeDefined();
  });

  it("respects { softDeletes: false } even when the strategy is soft", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "soft" }) as any,
      { title: string() },
      { softDeletes: false },
    );

    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeUndefined();
  });

  it("forces the column with { softDeletes: true } even when permanent", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "permanent" }) as any,
      { title: string() },
      { softDeletes: true },
    );

    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeDefined();
  });

  it("uses the model's custom deletedAtColumn name", async () => {
    const Migration_ = Migration.create(
      makeModel({
        deleteStrategy: "soft",
        deletedAtColumn: "archivedAt",
      }) as any,
      { title: string() },
    );

    const columns = await addedColumns(Migration_);

    expect(find(columns, "archivedAt")).toBeDefined();
    expect(find(columns, "deletedAt")).toBeUndefined();
  });

  it("does not duplicate a deletedAt column already declared in the map", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "soft" }) as any,
      {
        deletedAt: dateTime().nullable(),
      },
    );

    const columns = await addedColumns(Migration_);
    const matches = columns.filter((column) => column.name === "deletedAt");

    expect(matches).toHaveLength(1);
  });

  it("skips soft-delete wiring when the model disables it with deletedAtColumn = false", async () => {
    const Migration_ = Migration.create(
      makeModel({ deleteStrategy: "soft", deletedAtColumn: false }) as any,
      { title: string() },
    );

    const columns = await addedColumns(Migration_);

    expect(find(columns, "deletedAt")).toBeUndefined();
  });
});
