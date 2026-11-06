import { describe, expect, it, vi } from "vitest";
import {
  BaseNotificationsRepository,
  databaseChannel,
  type Notifiable,
  notificationColumns,
  RecipientTypeRequiredError,
  recipientTypeOf,
} from "../../../src";

function stubModel(columnMap?: Record<string, string>) {
  return class StubModel {
    public static columnMap = columnMap;
    public static events() {
      return new Proxy({}, { get: () => () => () => undefined });
    }
  };
}

function makeRepo(columnMap?: Record<string, string>) {
  const repo = new BaseNotificationsRepository(stubModel(columnMap) as any);
  return {
    repo,
    create: vi.spyOn(repo as any, "create").mockResolvedValue({ id: "n1" }),
    updateMany: vi.spyOn(repo as any, "updateMany").mockResolvedValue(1),
    deleteMany: vi.spyOn(repo as any, "deleteMany").mockResolvedValue(1),
    first: vi.spyOn(repo as any, "first").mockResolvedValue(null),
  };
}

const typed = { recipientType: "recipient_type" };

const staff = { id: 5, userType: "staff", get: () => undefined, constructor: { table: "staff" } };
const customer = { id: 5, get: () => undefined, constructor: { table: "customers" } };

describe("recipientTypeOf", () => {
  it("uses the auth model's userType, else the table name", () => {
    expect(recipientTypeOf(staff as unknown as Notifiable)).toBe("staff");
    expect(recipientTypeOf(customer as unknown as Notifiable)).toBe("customers");
  });
});

describe("typed recipients", () => {
  it("createFor stores the recipient type and ignores a type smuggled in the payload", async () => {
    const h = makeRepo(typed);
    await h.repo.createFor({ id: 5, type: "staff" }, {
      type: "x",
      title: "t",
      recipient_type: "customers",
      recipientType: "customers",
    } as any);

    const row = h.create.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 5, recipient_type: "staff" });
  });

  it("scopes read, mark, and delete by type and id", async () => {
    const h = makeRepo(typed);

    await h.repo.findFor(staff as unknown as Notifiable, "n1");
    expect(h.first).toHaveBeenCalledWith({ recipientId: 5, recipientType: "staff", id: "n1" });

    await h.repo.markRead(customer as unknown as Notifiable);
    expect(h.updateMany.mock.calls[0][0]).toMatchObject({
      user_id: 5,
      recipient_type: "customers",
    });

    await h.repo.deleteFor({ id: 5, type: "staff" }, "n9");
    expect(h.deleteMany).toHaveBeenCalledWith({ user_id: 5, recipient_type: "staff", id: "n9" });
  });

  it("rejects a bare id instead of crossing types", () => {
    const h = makeRepo(typed);
    expect(() => h.repo.markRead(5)).toThrow(RecipientTypeRequiredError);
    expect(() => h.repo.deleteFor(5)).toThrow(RecipientTypeRequiredError);
    expect(() => h.repo.scopeOf(5)).toThrow(RecipientTypeRequiredError);
  });

  it("idempotent lookup is typed too", async () => {
    const h = makeRepo(typed);
    await h.repo.createFor(
      { id: 5, type: "staff" },
      { type: "x", title: "t", idempotencyKey: "k" },
    );
    expect(h.first).toHaveBeenCalledWith({
      recipientId: 5,
      recipientType: "staff",
      idempotencyKey: "k",
    });
  });
});

describe("tables without a recipient type column", () => {
  it("keeps id-only scoping and accepts bare ids", async () => {
    const h = makeRepo();
    await h.repo.markRead(5, "n1");
    expect(h.updateMany.mock.calls[0][0]).toEqual({ user_id: 5, read_at: null, id: "n1" });
    expect(h.repo.scopeOf({ id: 5, type: "staff" })).toEqual({ recipientId: 5 });
  });
});

describe("databaseChannel", () => {
  it("routes with the recipient type and writes it", async () => {
    const h = makeRepo(typed);
    const channel = databaseChannel(h.repo);
    const route = channel.route!(staff as unknown as Notifiable);
    expect(route).toEqual({ id: 5, type: "staff" });

    await channel.send({
      payload: { type: "x", title: "t" },
      route: route!,
      notifiable: staff as unknown as Notifiable,
      options: {},
    });
    expect(h.create.mock.calls[0][0]).toMatchObject({ user_id: 5, recipient_type: "staff" });
  });
});

describe("notificationColumns recipient type + id default", () => {
  it("adds the recipient type column only when declared", () => {
    expect("recipient_type" in notificationColumns({ columnMap: typed })).toBe(true);
    expect("recipient_type" in notificationColumns()).toBe(false);
  });

  it("keeps uuid without a recipient model, derives integer or uuid from one", () => {
    expect(notificationColumns().user_id.getDefinition().type).toBe("uuid");
    expect(notificationColumns({ recipientModel: {} }).user_id.getDefinition().type).toBe(
      "integer",
    );
    expect(
      notificationColumns({ recipientModel: { autoGenerateId: false } }).user_id.getDefinition()
        .type,
    ).toBe("uuid");
    expect(notificationColumns({ idType: "uuid" }).user_id.getDefinition().type).toBe("uuid");
  });
});
