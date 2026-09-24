import { beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "../../../src/model/model";
import { DatabaseRestorer } from "../../../src/restorer/database-restorer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class TrashedUser extends Model {
  public static table = "users";
  public static primaryKey = "_id";
  public static deleteStrategy = "trash" as const;
}

describe("DatabaseRestorer - Mongo assignNew id", () => {
  const generateNextId = vi.fn();
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    generateNextId.mockResolvedValue(99);
    insert.mockResolvedValue({ document: {} });

    const driver = createMockDriver({ name: "mongodb" } as any);
    const trashed = { _id: "old-oid", id: 7, name: "Ann", deletedAt: new Date(), originalTable: "users" };
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(trashed),
      exists: vi.fn().mockResolvedValue(true),
    };

    (driver as any).queryBuilder = vi.fn().mockReturnValue(queryBuilder);
    (driver as any).insert = insert;
    (driver as any).delete = vi.fn().mockResolvedValue(1);

    const dataSource = createMockDataSource({ driver, idGenerator: { generateNextId } as any });

    vi.spyOn(TrashedUser, "getDataSource").mockReturnValue(dataSource);
  });

  it("generates a new id through the writer when the old id conflicts", async () => {
    const result = await new DatabaseRestorer(TrashedUser).restore(7, { strategy: "trash" });

    expect(generateNextId).toHaveBeenCalledWith(expect.objectContaining({ table: "users" }));

    const inserted = insert.mock.calls[0][1];

    expect(inserted.id).toBe(99);
    expect(inserted._id).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
