import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import events from "@mongez/events";
import { Model } from "../../../src/model/model";
import { DatabaseRemover } from "../../../src/remover/database-remover";
import { DatabaseRestorer } from "../../../src/restorer/database-restorer";
import { getModelDeletedEvent, getModelUpdatedEvent } from "../../../src/sync/model-events";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class SyncModel extends Model {
  static table = "sync_models";
  static primaryKey = "id";
  static deleteStrategy?: "trash" | "permanent" | "soft";
  static deletedAtColumn = "deletedAt";
}

describe("soft delete / restore sync", () => {
  const driver = createMockDriver();
  const dataSource = createMockDataSource({ driver });
  const deleted = vi.fn();
  const updated = vi.fn();
  const subs: any[] = [];

  afterEach(() => {
    subs.splice(0).forEach((sub) => sub.unsubscribe());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SyncModel, "getDataSource").mockReturnValue(dataSource);
    subs.push(events.subscribe(getModelDeletedEvent(SyncModel), deleted));
    subs.push(events.subscribe(getModelUpdatedEvent(SyncModel), updated));
  });

  it("does not fire the deleted sync event for a soft delete", async () => {
    SyncModel.deleteStrategy = "soft";
    const model = new SyncModel({ id: 1 });
    model.isNew = false;
    await new DatabaseRemover(model).destroy();
    expect(deleted).not.toHaveBeenCalled();
  });

  it("fires the updated sync event when a soft-deleted record is restored", async () => {
    SyncModel.deleteStrategy = "soft";
    const qb = { where: vi.fn().mockReturnThis(), whereNotNull: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ id: 1, deletedAt: new Date() }), exists: vi.fn().mockResolvedValue(true) };
    (driver as any).queryBuilder = vi.fn().mockReturnValue(qb);
    (driver as any).update = vi.fn().mockResolvedValue(1);
    await new DatabaseRestorer(SyncModel as any).restore(1);
    expect(updated).toHaveBeenCalledTimes(1);
  });
});
