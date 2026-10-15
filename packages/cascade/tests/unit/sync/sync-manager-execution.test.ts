import { describe, expect, it, vi } from "vitest";
import { PostgresDriver } from "../../../src/drivers/postgres/postgres-driver";
import { SyncManager } from "../../../src/sync/sync-manager";

const instruction = (table: string, id: number) => ({
  targetTable: table,
  targetModel: "Post",
  filter: { "tags.id": id },
  update: { $set: { "tags.$": { id, name: "x" } } },
  depth: 1,
  chain: ["Tag"],
  sourceModel: "Tag",
  sourceId: id,
  isArrayUpdate: true,
  arrayField: "tags",
  identifierField: "id",
  identifierValue: id,
});

describe("SyncManager — execution", () => {
  it("runs each instruction once through the driver's sync adapter, even when one fails", async () => {
    const executeBatch = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(2);
    const updateMany = vi.fn();
    const driver = { syncAdapter: () => ({ executeBatch }), updateMany };
    const manager = new SyncManager({ name: "Tag" } as any, driver as any) as any;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await manager.executeInstructions([
      instruction("posts", 1),
      instruction("posts", 2),
      instruction("posts", 3),
    ]);

    expect(executeBatch).toHaveBeenCalledTimes(3);
    expect(updateMany).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.contexts).toHaveLength(2);
  });
});

describe("PostgresDriver — sync instructions", () => {
  const driver = () => new PostgresDriver({} as any) as any;

  it("translates a positional $set to a jsonb array rewrite, not a \"tags.$\" column", () => {
    const { sql, params } = driver().buildSyncStatement(instruction("posts", 5));

    expect(sql).not.toContain('"tags.$"');
    expect(sql).toContain('UPDATE "posts" SET "tags" = (SELECT COALESCE(jsonb_agg(CASE WHEN');
    expect(sql).toContain("EXISTS (SELECT 1 FROM jsonb_array_elements");
    expect(params).toContain(JSON.stringify({ id: 5, name: "x" }));
  });

  it("translates $pull to an element filter", () => {
    const { sql } = driver().buildSyncStatement({
      ...instruction("posts", 5),
      update: { $pull: { tags: { id: 5 } } },
    });

    expect(sql).toContain("IS DISTINCT FROM");
  });

  it("sets a single embedded object as jsonb", () => {
    const { sql } = driver().buildSyncStatement({
      ...instruction("posts", 5),
      isArrayUpdate: undefined,
      filter: { "category.id": 5 },
      update: { $set: { category: { id: 5 } } },
    });

    expect(sql).toContain('"category" = $1::jsonb');
  });
});
