import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { markRawInput, Model } from "./model";

class Account extends Model<{ name?: string; role?: string; isAdmin?: boolean; id?: number }> {
  public static table = "accounts";
  public static guarded = ["role", "isAdmin"];
}

class OpenAccount extends Model<{ name?: string; role?: string }> {
  public static table = "open_accounts";
}

describe("Model.guarded", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    dataSourceRegistry.clear();

    const driver = {
      dialect: new PostgresDialect(),
      on: () => undefined,
      getDirtyTracker: () => ({ mergeChanges: () => undefined, setAtPath: () => undefined }),
    };
    dataSourceRegistry.register(
      new DataSource({ name: "guarded", driver: driver as never, isDefault: true }),
    );
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merge() skips guarded columns and keeps the rest", () => {
    const account = new Account({ name: "Ann" });
    const input = { name: "Bea", role: "admin", isAdmin: true };

    account.merge(input);

    expect(account.data).toEqual({ name: "Bea" });
    expect(input).toEqual({ name: "Bea", role: "admin", isAdmin: true });
  });

  it("skips a dot path inside a guarded column", () => {
    const account = new Account({});

    account.merge({ "role.level": 3, name: "Ann" } as never);

    expect(account.data).toEqual({ name: "Ann" });
  });

  it("the object form of set() skips guarded columns, single-key set() does not", () => {
    const account = new Account({});

    account.set({ name: "Ann", role: "admin" } as never);
    expect(account.data).toEqual({ name: "Ann" });

    account.set("role", "editor");
    expect(account.get("role")).toBe("editor");
  });

  it("forceMerge() writes guarded columns", () => {
    const account = new Account({});

    account.forceMerge({ role: "admin" });

    expect(account.get("role")).toBe("admin");
  });

  it("create() skips guarded columns and forceCreate() writes them", async () => {
    const save = vi.spyOn(Model.prototype, "save").mockImplementation(async function (this: Model) {
      return this;
    });

    const created = await Account.create({ name: "Ann", role: "admin" });
    const forced = await Account.forceCreate({ name: "Bea", role: "admin" });

    expect(save).toHaveBeenCalledTimes(2);
    expect(created.data).toEqual({ name: "Ann" });
    expect(forced.data).toEqual({ name: "Bea", role: "admin" });
  });

  it("warns once per model and column outside production", () => {
    class Member extends Model<{ role?: string }> {
      public static table = "members";
      public static guarded = ["role"];
    }
    const member = new Member({});

    member.merge({ role: "a" });
    member.merge({ role: "b" });

    const guardedWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("skipped"));

    expect(guardedWarnings).toHaveLength(1);
  });

  it("a model without guarded columns merges everything", () => {
    const account = new OpenAccount({});

    account.merge({ role: "admin" });

    expect(account.get("role")).toBe("admin");
  });

  it("warns once when marked raw request input is merged", () => {
    const open = new OpenAccount({});

    open.merge(markRawInput({ name: "Ann" }));
    open.merge(markRawInput({ name: "Bea" }));
    open.merge({ name: "Cy" });

    const rawWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("raw input"));

    expect(rawWarnings).toHaveLength(1);
  });
});
