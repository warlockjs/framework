import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseNotificationsRepository } from "../../../src";

/**
 * Stub model — only `events()` is touched (by RepositoryManager's deferred
 * registerEvents); return a Proxy whose every method is a no-op subscription.
 */
class StubModel {
  public static events() {
    return new Proxy({}, { get: () => () => () => undefined });
  }
}

/**
 * Build a repo and spy on the RepositoryManager methods so nothing reaches a
 * real adapter. `toRow` (the logical→physical mapper under test) runs for real.
 */
function makeRepo() {
  const repo = new BaseNotificationsRepository(StubModel as any);
  const create = vi.spyOn(repo as any, "create").mockResolvedValue({ id: "n1" });
  const updateMany = vi.spyOn(repo as any, "updateMany").mockResolvedValue(1);
  const deleteMany = vi.spyOn(repo as any, "deleteMany").mockResolvedValue(1);
  const first = vi.spyOn(repo as any, "first").mockResolvedValue(null);
  return { repo, create, updateMany, deleteMany, first };
}

describe("BaseNotificationsRepository write-path column mapping (the blocker fix)", () => {
  let h: ReturnType<typeof makeRepo>;
  beforeEach(() => {
    h = makeRepo();
  });

  it("createFor maps logical keys → physical columns (user_id / is_read)", async () => {
    await h.repo.createFor("u42", { type: "order.shipped", title: "Hi", body: "b" });

    const row = h.create.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: "u42",
      is_read: false,
      type: "order.shipped",
      title: "Hi",
      body: "b",
    });
    // The literal logical keys must NOT leak to the DB.
    expect(row).not.toHaveProperty("recipientId");
    expect(row).not.toHaveProperty("isRead");
  });

  it("createFor with idempotencyKey returns the existing row (find-or-create)", async () => {
    h.first.mockResolvedValueOnce({ id: "existing" });

    const result = await h.repo.createFor("u42", {
      type: "x",
      title: "Hi",
      idempotencyKey: "k1",
    });

    expect(result).toEqual({ id: "existing" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("createFor inserts with the physical idempotency_key column when none exists", async () => {
    await h.repo.createFor("u42", { type: "x", title: "Hi", idempotencyKey: "k1" });

    expect(h.create.mock.calls[0][0]).toMatchObject({
      user_id: "u42",
      idempotency_key: "k1",
    });
  });

  it("createFor re-fetches on a unique-constraint race and returns the winner", async () => {
    h.create.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    h.first
      .mockResolvedValueOnce(null) // pre-insert lookup misses
      .mockResolvedValueOnce({ id: "winner" }); // post-conflict re-fetch hits

    const result = await h.repo.createFor("u42", {
      type: "x",
      title: "Hi",
      idempotencyKey: "k1",
    });

    expect(result).toEqual({ id: "winner" });
  });

  it("markRead maps both filter AND data to physical columns", async () => {
    await h.repo.markRead("u42", "n9");

    expect(h.updateMany).toHaveBeenCalledWith(
      { user_id: "u42", is_read: false, id: "n9" },
      expect.objectContaining({ is_read: true, read_at: expect.any(Date) }),
    );
  });

  it("markRead without id targets all unread for the recipient", async () => {
    await h.repo.markRead("u42");
    expect(h.updateMany).toHaveBeenCalledWith(
      { user_id: "u42", is_read: false },
      expect.objectContaining({ is_read: true }),
    );
  });

  it("markUnread maps to physical columns and nulls read_at", async () => {
    await h.repo.markUnread("u42", "n9");
    expect(h.updateMany).toHaveBeenCalledWith(
      { user_id: "u42", is_read: true, id: "n9" },
      { is_read: false, read_at: null },
    );
  });

  it("deleteFor maps the filter to physical columns", async () => {
    await h.repo.deleteFor("u42", "n9");
    expect(h.deleteMany).toHaveBeenCalledWith({ user_id: "u42", id: "n9" });
  });

  it("a subclass that overrides filterBy retargets BOTH read and write columns", async () => {
    class MyRepo extends BaseNotificationsRepository {
      public filterBy = {
        id: "=",
        type: "=",
        isRead: ["=", "seen"],
        readAt: ["=", "seen_at"],
        recipientId: ["=", "audience_id"],
        idempotencyKey: ["=", "idempotency_key"],
      } as any;
    }
    const repo = new MyRepo(StubModel as any);
    const create = vi.spyOn(repo as any, "create").mockResolvedValue({ id: "n1" });

    await repo.createFor("a1", { type: "x", title: "Hi" });

    expect(create.mock.calls[0][0]).toMatchObject({ audience_id: "a1", seen: false });
  });
});
