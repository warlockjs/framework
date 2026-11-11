import { v } from "@warlock.js/seal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertRecord } from "../../../src/model/methods/write-methods";
import { Model } from "../../../src/model/model";
import { DatabaseRestorer } from "../../../src/restorer/database-restorer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

/**
 * `upsert()` and `restore()` / `restoreAll()` honour the model's global
 * scopes (tenant, ...) like the other write statics. A soft-delete scope is
 * the one scope restore looks past: hiding deleted rows is what it undoes.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsert() and global scopes", () => {
  function setup(withTenantScope: boolean) {
    class Contact extends Model {
      public static table = "contacts";
      public static autoGenerateId = false;
      public static createdAtColumn: string | false = false;
      public static updatedAtColumn: string | false = false;
      public static schema = v.object({ email: v.string(), name: v.string() });
    }

    if (withTenantScope) {
      Contact.addGlobalScope("tenant", (query) => query.where("tenantId", 1));
    }

    const driver = createMockDriver();
    vi.mocked(driver.findOneAndUpdate).mockResolvedValue({ id: 7, email: "a@b.c", name: "n" });
    vi.spyOn(Contact, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
    vi.spyOn(Contact, "getDriver").mockReturnValue(driver);

    return { Contact, driver };
  }

  function scopedQuery(visibleIds: unknown[], hiddenMatch: boolean) {
    return {
      where: () => ({ pluck: async () => visibleIds }),
      withoutGlobalScopes: () => ({ where: () => ({ exists: async () => hiddenMatch }) }),
    };
  }

  it("pins the write to the visible row", async () => {
    const { Contact, driver } = setup(true);
    vi.spyOn(Contact, "query").mockReturnValue(scopedQuery([7], false) as any);

    await upsertRecord(Contact as any, { email: "a@b.c" }, { name: "n" });

    const [, filter] = (driver.findOneAndUpdate as any).mock.calls.at(-1);
    expect(filter).toEqual({ email: "a@b.c", id: 7 });
  });

  it("refuses to touch a row another tenant owns", async () => {
    const { Contact, driver } = setup(true);
    vi.spyOn(Contact, "query").mockReturnValue(scopedQuery([], true) as any);

    await expect(upsertRecord(Contact as any, { email: "a@b.c" }, { name: "n" })).rejects.toThrow(
      /hidden by a global scope/,
    );
    expect(driver.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("inserts when no row matches at all", async () => {
    const { Contact, driver } = setup(true);
    vi.spyOn(Contact, "query").mockReturnValue(scopedQuery([], false) as any);

    await upsertRecord(Contact as any, { email: "a@b.c" }, { name: "n" });

    const [, filter] = (driver.findOneAndUpdate as any).mock.calls.at(-1);
    expect(filter).toEqual({ email: "a@b.c" });
  });

  it("sends the filter unchanged, with no lookup, when the model has no scope", async () => {
    const { Contact, driver } = setup(false);
    const query = vi.spyOn(Contact, "query");

    await upsertRecord(Contact as any, { email: "a@b.c" }, { name: "n" });

    expect(query).not.toHaveBeenCalled();
    expect((driver.findOneAndUpdate as any).mock.calls.at(-1)[1]).toEqual({ email: "a@b.c" });
  });
});

describe("restore() / restoreAll() and global scopes", () => {
  type Builder = {
    table: string;
    pendingGlobalScopes?: Map<string, unknown>;
    where: ReturnType<typeof vi.fn>;
    whereNotNull: ReturnType<typeof vi.fn>;
    whereIn: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    pluck: ReturnType<typeof vi.fn>;
  };

  function setup(options: {
    strategy: "soft" | "trash";
    rows: Record<string, unknown>[];
    visibleIds: unknown[];
    scopes: boolean;
  }) {
    class Post extends Model {
      public static table = "posts";
      public static primaryKey = "id";
      public static deleteStrategy = options.strategy;
      public static deletedAtColumn: string | false = "deletedAt";
    }

    if (options.scopes) {
      Post.addGlobalScope("tenant", (query) => query.where("tenantId", 1));
      Post.addGlobalScope("notDeleted", (query) => query.whereNull("deletedAt"));
    }

    const builders: Builder[] = [];
    const driver = createMockDriver();

    (driver as any).queryBuilder = vi.fn((table: string) => {
      const builder: Builder = {
        table,
        where: vi.fn(() => builder),
        whereNotNull: vi.fn(() => builder),
        whereIn: vi.fn(() => builder),
        first: vi.fn(async () => options.rows[0] ?? null),
        get: vi.fn(async () => options.rows),
        exists: vi.fn(async () =>
          builder.where.mock.calls.some(([, value]) => options.visibleIds.includes(value)),
        ),
        pluck: vi.fn(async () => options.visibleIds),
      };

      builders.push(builder);

      return builder;
    });

    vi.spyOn(Post, "getDataSource").mockReturnValue(createMockDataSource({ driver }));

    const scopedBuilders = () => builders.filter((builder) => builder.pendingGlobalScopes);

    return { Post, driver, scopedBuilders };
  }

  it("restores a soft-deleted row the caller's scopes can see", async () => {
    const { Post, driver, scopedBuilders } = setup({
      strategy: "soft",
      rows: [{ id: 1, tenantId: 1, deletedAt: new Date() }],
      visibleIds: [1],
      scopes: true,
    });

    await new DatabaseRestorer(Post).restore(1);

    expect(driver.update).toHaveBeenCalledTimes(1);

    // The tenant scope applies; the soft-delete scope does not.
    const [scoped] = scopedBuilders();
    expect(Array.from(scoped!.pendingGlobalScopes!.keys())).toEqual(["tenant"]);
  });

  it("refuses to restore a row another tenant owns", async () => {
    const { Post, driver } = setup({
      strategy: "soft",
      rows: [{ id: 2, tenantId: 2, deletedAt: new Date() }],
      visibleIds: [],
      scopes: true,
    });

    await expect(new DatabaseRestorer(Post).restore(2)).rejects.toThrow(/record not found/);
    expect(driver.update).not.toHaveBeenCalled();
  });

  it("refuses to restore a trashed row another tenant owns", async () => {
    const { Post, driver } = setup({
      strategy: "trash",
      rows: [{ id: 2, tenantId: 2, originalTable: "posts" }],
      visibleIds: [],
      scopes: true,
    });

    await expect(new DatabaseRestorer(Post).restore(2)).rejects.toThrow(/record not found/);
    expect(driver.insert).not.toHaveBeenCalled();
  });

  it("restoreAll() restores only the rows the caller's scopes can see", async () => {
    const { Post, driver } = setup({
      strategy: "soft",
      rows: [
        { id: 1, tenantId: 1, deletedAt: new Date() },
        { id: 2, tenantId: 2, deletedAt: new Date() },
      ],
      visibleIds: [1],
      scopes: true,
    });

    const result = await new DatabaseRestorer(Post).restoreAll();

    expect(result.restoredCount).toBe(1);
    expect(driver.update).toHaveBeenCalledTimes(1);
    expect((driver.update as any).mock.calls[0][1]).toEqual({ id: 1 });
  });

  it("runs no extra query for a model without global scopes", async () => {
    const { Post, driver, scopedBuilders } = setup({
      strategy: "soft",
      rows: [{ id: 3, deletedAt: new Date() }],
      visibleIds: [],
      scopes: false,
    });

    await new DatabaseRestorer(Post).restore(3);

    expect(scopedBuilders()).toHaveLength(0);
    expect(driver.update).toHaveBeenCalledTimes(1);
  });

  it("never skips a scope whose column only contains the soft-delete column's name", async () => {
    const { Post, scopedBuilders } = setup({
      strategy: "soft",
      rows: [{ id: 1, tenantId: 1, deletedAt: new Date() }],
      visibleIds: [1],
      scopes: false,
    });

    Post.addGlobalScope("region", (query) => query.where("notDeletedAtRegion", "eu"));
    Post.addGlobalScope("source", (query) => query.where({ deletedAtSource: "import" }));
    Post.addGlobalScope("byValue", (query) => query.where("status", "deletedAt"));
    Post.addGlobalScope("notDeleted", (query) => query.whereNull("deletedAt"));

    await new DatabaseRestorer(Post).restore(1);

    const [scoped] = scopedBuilders();
    expect(Array.from(scoped!.pendingGlobalScopes!.keys())).toEqual([
      "region",
      "source",
      "byValue",
    ]);
  });

  it("keeps the other filters of a scope that also filters the soft-delete column", async () => {
    const { Post, scopedBuilders } = setup({
      strategy: "soft",
      rows: [{ id: 1, tenantId: 1, deletedAt: new Date() }],
      visibleIds: [1],
      scopes: false,
    });

    Post.addGlobalScope("tenantAndLive", (query) =>
      query
        .where("tenantId", 1)
        .whereNull("deletedAt")
        .where({ deletedAt: null, ownerId: 7 })
        .where((sub: any) => sub.whereNull("posts.deletedAt")),
    );

    await new DatabaseRestorer(Post).restore(1);

    const [scoped] = scopedBuilders();
    const definition = scoped!.pendingGlobalScopes!.get("tenantAndLive") as {
      callback: (query: unknown) => void;
    };
    const calls: unknown[][] = [];
    const query: any = new Proxy(
      {},
      {
        get:
          (_target, method) =>
          (...args: unknown[]) => {
            calls.push([method, ...args]);
            return query;
          },
      },
    );

    definition.callback(query);

    expect(calls).toEqual([
      ["where", "tenantId", 1],
      ["where", { ownerId: 7 }],
    ]);
  });

  it("recognises a soft-delete scope written in any where form", async () => {
    const { Post, scopedBuilders } = setup({
      strategy: "soft",
      rows: [{ id: 1, tenantId: 1, deletedAt: new Date() }],
      visibleIds: [1],
      scopes: false,
    });

    Post.addGlobalScope("tenant", (query) => query.where("tenantId", 1));
    Post.addGlobalScope("objectForm", (query) => query.where({ deletedAt: null }));
    Post.addGlobalScope("nested", (query) =>
      query.where((sub: any) => sub.whereNull("deletedAt").orWhere("deletedAt", ">", 0)),
    );

    await new DatabaseRestorer(Post).restore(1);

    const [scoped] = scopedBuilders();
    expect(Array.from(scoped!.pendingGlobalScopes!.keys())).toEqual(["tenant"]);
  });
});
