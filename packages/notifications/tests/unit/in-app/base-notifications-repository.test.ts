import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseNotificationsRepository, type DatabasePayload } from "../../../src";

/**
 * Stub model carrying a `columnMap` static. Only `events()` is otherwise
 * touched (by RepositoryManager's deferred registerEvents) — a Proxy makes
 * every subscription a no-op.
 */
function stubModel(columnMap?: Record<string, string>) {
  return class StubModel {
    public static columnMap = columnMap;
    public static events() {
      return new Proxy({}, { get: () => () => () => undefined });
    }
  };
}

/**
 * Build a repo for the given model and spy on the RepositoryManager methods so
 * nothing reaches a real adapter. `toRow` (the logical→physical mapper under
 * test) runs for real.
 */
function makeRepo(model?: ReturnType<typeof stubModel>) {
  const repo = new BaseNotificationsRepository(model as any);
  const create = vi.spyOn(repo as any, "create").mockResolvedValue({ id: "n1" });
  const updateMany = vi.spyOn(repo as any, "updateMany").mockResolvedValue(1);
  const deleteMany = vi.spyOn(repo as any, "deleteMany").mockResolvedValue(1);
  const first = vi.spyOn(repo as any, "first").mockResolvedValue(null);
  return { repo, create, updateMany, deleteMany, first };
}

describe("BaseNotificationsRepository — both read-state columns (is_read + read_at)", () => {
  const Both = stubModel({ tenant: "organization_id", isRead: "is_read", readAt: "read_at" });
  let h: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    h = makeRepo(Both);
  });

  it("createFor maps logical keys → physical columns and starts unread", async () => {
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

  it("createFor writes the tenant column from the tenantId argument", async () => {
    await h.repo.createFor("u42", { type: "x", title: "Hi" }, "org_7");

    expect(h.create.mock.calls[0][0]).toMatchObject({
      user_id: "u42",
      organization_id: "org_7",
    });
  });

  it("createFor with idempotencyKey returns the existing row (find-or-create)", async () => {
    h.first.mockResolvedValueOnce({ id: "existing" });

    const result = await h.repo.createFor("u42", { type: "x", title: "Hi", idempotencyKey: "k1" });

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

    const result = await h.repo.createFor("u42", { type: "x", title: "Hi", idempotencyKey: "k1" });

    expect(result).toEqual({ id: "winner" });
  });

  it("markRead scopes to unread via is_read and sets both columns", async () => {
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

  it("markUnread nulls read_at and clears is_read (no unread scope)", async () => {
    await h.repo.markUnread("u42", "n9");

    expect(h.updateMany).toHaveBeenCalledWith(
      { user_id: "u42", id: "n9" },
      { is_read: false, read_at: null },
    );
  });

  it("deleteFor maps the filter to physical columns", async () => {
    await h.repo.deleteFor("u42", "n9");

    expect(h.deleteMany).toHaveBeenCalledWith({ user_id: "u42", id: "n9" });
  });
});

describe("BaseNotificationsRepository — read_at-only (default columnMap)", () => {
  const ReadAtOnly = stubModel();
  let h: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    h = makeRepo(ReadAtOnly);
  });

  it("createFor sets no read flag — new rows are unread by a null read_at", async () => {
    await h.repo.createFor("u42", { type: "x", title: "Hi" });

    const row = h.create.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: "u42" });
    expect(row).not.toHaveProperty("is_read");
    expect(row).not.toHaveProperty("read_at");
  });

  it("markRead scopes to `read_at IS NULL` and stamps read_at", async () => {
    await h.repo.markRead("u42", "n9");

    expect(h.updateMany).toHaveBeenCalledWith(
      { user_id: "u42", read_at: null, id: "n9" },
      { read_at: expect.any(Date) },
    );
  });

  it("markUnread nulls read_at", async () => {
    await h.repo.markUnread("u42");

    expect(h.updateMany).toHaveBeenCalledWith({ user_id: "u42" }, { read_at: null });
  });
});

describe("BaseNotificationsRepository — server-owned keys cannot be mass-assigned", () => {
  const Both = stubModel({ tenant: "organization_id", isRead: "is_read", readAt: "read_at" });
  let h: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    h = makeRepo(Both);
  });

  it("createFor ignores a recipientId smuggled into the payload — the trusted argument wins", async () => {
    await h.repo.createFor("u42", {
      type: "order.shipped",
      title: "Hi",
      recipientId: "victim-1",
    } as DatabasePayload);

    const row = h.create.mock.calls[0][0];
    expect(row.user_id).toBe("u42");
    expect(row).not.toHaveProperty("recipientId");
  });

  it("createFor ignores the PHYSICAL recipient column smuggled into the payload", async () => {
    await h.repo.createFor("u42", {
      type: "x",
      title: "Hi",
      user_id: "victim-1",
    } as DatabasePayload);

    expect(h.create.mock.calls[0][0].user_id).toBe("u42");
  });

  it("createFor ignores smuggled id / tenant / read-state keys — trusted values win", async () => {
    await h.repo.createFor(
      "u42",
      {
        type: "x",
        title: "Hi",
        id: "n999",
        tenant: "evil-org",
        organization_id: "evil-org",
        isRead: true,
        is_read: true,
        readAt: new Date(),
        read_at: new Date(),
      } as DatabasePayload,
      "org_7",
    );

    const row = h.create.mock.calls[0][0];
    expect(row).not.toHaveProperty("id");
    expect(row.organization_id).toBe("org_7");
    expect(row.is_read).toBe(false);
    expect(row).not.toHaveProperty("read_at");
  });

  it("createFor still passes legitimate payload fields through alongside hostile keys", async () => {
    await h.repo.createFor("u42", {
      type: "order.shipped",
      title: "Hi",
      body: "b",
      payload: { orderId: 7 },
      idempotencyKey: "k1",
      recipientId: "victim-1",
    } as DatabasePayload);

    expect(h.create.mock.calls[0][0]).toMatchObject({
      user_id: "u42",
      type: "order.shipped",
      title: "Hi",
      body: "b",
      payload: { orderId: 7 },
      idempotency_key: "k1",
    });
  });

  it("createFor strips the RENAMED physical recipient column too", async () => {
    const Renamed = stubModel({ recipient: "audience_id" });
    const renamed = makeRepo(Renamed);

    await renamed.repo.createFor("a1", {
      type: "x",
      title: "Hi",
      recipientId: "victim-1",
      audience_id: "victim-1",
    } as DatabasePayload);

    expect(renamed.create.mock.calls[0][0].audience_id).toBe("a1");
  });
});

describe("BaseNotificationsRepository — renamed columns drive both paths", () => {
  it("createFor uses the model's recipient + read-state column names", async () => {
    const Renamed = stubModel({ recipient: "audience_id", isRead: "seen" });
    const h = makeRepo(Renamed);

    await h.repo.createFor("a1", { type: "x", title: "Hi" });

    expect(h.create.mock.calls[0][0]).toMatchObject({ audience_id: "a1", seen: false });
  });
});
