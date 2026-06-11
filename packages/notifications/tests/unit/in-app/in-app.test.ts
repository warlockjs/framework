import { describe, expect, it, vi } from "vitest";
import { BaseNotificationsRepository, inApp, type Notifiable } from "../../../src";

const makeNotifiable = (overrides: Record<string, any> = {}): Notifiable =>
  ({
    id: overrides.id ?? "u1",
    get: (key: string) => overrides[key],
  }) as unknown as Notifiable;

/**
 * Fake repo covering the surface `inApp` delegates to. The logical→physical
 * column mapping is tested directly in base-notifications-repository.test.ts;
 * here we only assert the facade delegates with recipient-scoped args.
 */
class FakeRepo {
  public list = vi.fn().mockResolvedValue([]);
  public countCached = vi.fn().mockResolvedValue(0);
  public markRead = vi.fn().mockResolvedValue(1);
  public markUnread = vi.fn().mockResolvedValue(1);
  public findFor = vi.fn().mockResolvedValue(null);
  public deleteFor = vi.fn().mockResolvedValue(1);
}

describe("inApp facade", () => {
  it("throws when used before `configure`", () => {
    (inApp as any).repo = undefined;
    expect(() => inApp.list(makeNotifiable())).toThrow(/not configured/);
  });

  it("`configure({ model })` builds the default BaseNotificationsRepository", () => {
    class FakeModel {
      public static events() {
        return new Proxy({}, { get: () => () => () => undefined });
      }
    }

    const channel = inApp.configure({ model: FakeModel as any });

    expect(channel.name).toBe("database");
    expect((inApp as any).repo).toBeInstanceOf(BaseNotificationsRepository);
  });

  it("`configure({ repository })` uses the passed instance", () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    expect((inApp as any).repo).toBe(repo);
  });

  it("`list` scopes by recipientId", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.list(makeNotifiable({ id: "u42" }), { type: "x" });
    expect(repo.list).toHaveBeenCalledWith({ type: "x", recipientId: "u42" });
  });

  it("`listUnread` adds isRead:false", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.listUnread(makeNotifiable({ id: "u42" }));
    expect(repo.list).toHaveBeenCalledWith({ recipientId: "u42", isRead: false });
  });

  it("`countUnread` uses the cached path", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.countUnread(makeNotifiable({ id: "u42" }));
    expect(repo.countCached).toHaveBeenCalledWith({ recipientId: "u42", isRead: false });
  });

  it("`find` delegates to repo.findFor scoped to the recipient", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.find(makeNotifiable({ id: "u42" }), "ntf_9");
    expect(repo.findFor).toHaveBeenCalledWith("u42", "ntf_9");
  });

  it("`markAsRead(user)` delegates with no id (all unread)", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.markAsRead(makeNotifiable({ id: "u42" }));
    expect(repo.markRead).toHaveBeenCalledWith("u42", undefined);
  });

  it("`markAsRead(user, id)` scopes to one row within the recipient", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.markAsRead(makeNotifiable({ id: "u42" }), "ntf_9");
    expect(repo.markRead).toHaveBeenCalledWith("u42", "ntf_9");
  });

  it("`markAsUnread(user, id)` delegates to repo.markUnread", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.markAsUnread(makeNotifiable({ id: "u42" }), "ntf_9");
    expect(repo.markUnread).toHaveBeenCalledWith("u42", "ntf_9");
  });

  it("`dismiss(user)` clears all for the recipient; `dismiss(user, id)` clears one", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });

    await inApp.dismiss(makeNotifiable({ id: "u42" }));
    expect(repo.deleteFor).toHaveBeenCalledWith("u42", undefined);

    await inApp.dismiss(makeNotifiable({ id: "u42" }), "ntf_9");
    expect(repo.deleteFor).toHaveBeenCalledWith("u42", "ntf_9");
  });

  it("accepts a raw id in place of a model", async () => {
    const repo = new FakeRepo();
    inApp.configure({ repository: repo as any });
    await inApp.list("u99");
    expect(repo.list).toHaveBeenCalledWith({ recipientId: "u99" });
  });
});
