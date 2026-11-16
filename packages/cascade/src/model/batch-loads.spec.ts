import { Context } from "@warlock.js/context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";

const loads = vi.hoisted(() => ({
  calls: [] as { count: number; relations: unknown }[],
  /** A load that includes the model with this id throws. */
  failFor: undefined as number | undefined,
}));

vi.mock("../relations/relation-loader", () => ({
  attachLoadedRelation: () => undefined,
  RelationLoader: class {
    public constructor(private readonly models: { get(key: string): unknown }[]) {}

    public async load(relations: unknown) {
      loads.calls.push({ count: this.models.length, relations });

      if (this.models.some((model) => model.get("id") === loads.failFor)) {
        throw new Error("malformed key");
      }
    }
  },
}));

import { Model } from "./model";
import type { ChildModel } from "./model.types";

class Post extends Model<{ id?: number; title?: string }> {
  public static table = "posts";
}

class TenantContext extends Context<{ tenant: string }> {
  public buildStore(): { tenant: string } {
    return { tenant: "" };
  }
}

const tenantContext = new TenantContext();

class Solo extends Model<{ id?: number }> {
  public static table = "solos";
  public static batchLoads = false;
}

function stubQuery(ModelClass: ChildModel<Model>, rows: Record<string, unknown>[]) {
  const whereIn = vi.fn((_field: string, ids: unknown[]) => ({
    get: async () => rows.filter((row) => ids.includes(row.id)).map((row) => new ModelClass(row)),
  }));
  const first = vi.fn();
  const where = vi.fn((_field: string, id: unknown) => ({
    first: async () => {
      first(id);
      const row = rows.find((candidate) => candidate.id === id);
      return row ? new ModelClass(row) : null;
    },
  }));

  vi.spyOn(ModelClass as unknown as typeof Model, "query").mockReturnValue({
    whereIn,
    where,
  } as never);

  return { whereIn, where, first };
}

describe("batched loads", () => {
  beforeEach(() => {
    loads.calls.length = 0;
    vi.restoreAllMocks();
    dataSourceRegistry.clear();

    const driver = {
      dialect: new PostgresDialect(),
      on: () => undefined,
      getDirtyTracker: () => ({}),
    };
    dataSourceRegistry.register(
      new DataSource({ name: "batch", driver: driver as never, isDefault: true }),
    );
  });

  it("runs load() calls of one tick as one relation load", async () => {
    const posts = [new Post({ id: 1 }), new Post({ id: 2 }), new Post({ id: 3 })];

    await Promise.all(posts.map((post) => post.load("author")));

    expect(loads.calls).toEqual([{ count: 3, relations: ["author"] }]);
  });

  it("keeps different relation sets apart and a lone call as it was", async () => {
    await Promise.all([
      new Post({ id: 1 }).load("author"),
      new Post({ id: 2 }).load("author"),
      new Post({ id: 3 }).load("tags"),
    ]);

    expect(loads.calls).toHaveLength(2);
    expect(loads.calls.map((call) => call.count).sort()).toEqual([1, 2]);
  });

  it("resolves every load() with its own model", async () => {
    const first = new Post({ id: 1 });
    const second = new Post({ id: 2 });

    const [a, b] = await Promise.all([first.load("author"), second.load("author")]);

    expect(a).toBe(first);
    expect(b).toBe(second);
  });

  it("opts out per model with batchLoads = false", async () => {
    await Promise.all([new Solo({ id: 1 }).load("x"), new Solo({ id: 2 }).load("x")]);

    expect(loads.calls.map((call) => call.count)).toEqual([1, 1]);
  });

  it("runs find() calls of one tick as one whereIn", async () => {
    const { whereIn, where } = stubQuery(Post, [
      { id: 1, title: "a" },
      { id: 2, title: "b" },
    ]);

    const found = await Promise.all([Post.find(1), Post.find(2), Post.find(99)]);

    expect(whereIn).toHaveBeenCalledTimes(1);
    expect(whereIn).toHaveBeenCalledWith("id", [1, 2, 99]);
    expect(where).not.toHaveBeenCalled();
    expect(found[0]?.get("title")).toBe("a");
    expect(found[1]?.get("title")).toBe("b");
    expect(found[2]).toBeNull();
  });

  it("keeps the single-row query for a lone find() and for a repeated id", async () => {
    const { whereIn, first } = stubQuery(Post, [{ id: 1, title: "a" }]);

    await Post.find(1);
    const [one, two] = await Promise.all([Post.find(1), Post.find(1)]);

    expect(whereIn).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(3);
    expect(one).not.toBe(two);
  });

  it("gives each find() its own result or error when the batched query fails", async () => {
    vi.spyOn(Post, "query").mockReturnValue({
      whereIn: () => ({
        get: async () => {
          throw new Error("invalid input syntax for type uuid");
        },
      }),
      where: (_field: string, id: unknown) => ({
        first: async () => {
          if (id === "bad") throw new Error("invalid input syntax for type uuid");
          return new Post({ id: 1, title: "a" });
        },
      }),
    } as never);

    const results = await Promise.allSettled([Post.find(1), Post.find("bad")]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("gives each load() its own result or error when the batched load fails", async () => {
    loads.failFor = 2;

    const results = await Promise.allSettled([
      new Post({ id: 1 }).load("author"),
      new Post({ id: 2 }).load("author"),
    ]);

    loads.failFor = undefined;

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("never batches calls made under other context stores", async () => {
    const seen: { tenant: string | undefined; ids: unknown[] }[] = [];
    const rows = [1, 2, 3, 4].map((id) => ({ id, title: `t${id}` }));

    vi.spyOn(Post, "query").mockImplementation(
      () =>
        ({
          whereIn: (_field: string, ids: unknown[]) => {
            seen.push({ tenant: tenantContext.get("tenant"), ids });

            return {
              get: async () =>
                rows.filter((row) => ids.includes(row.id)).map((row) => new Post(row)),
            };
          },
        }) as never,
    );

    const found = await Promise.all([
      tenantContext.run({ tenant: "a" }, () => Promise.all([Post.find(1), Post.find(2)])),
      tenantContext.run({ tenant: "b" }, () => Promise.all([Post.find(3), Post.find(4)])),
    ]);

    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual({ tenant: "a", ids: [1, 2] });
    expect(seen).toContainEqual({ tenant: "b", ids: [3, 4] });
    expect(found.flat().map((post) => post?.get("id"))).toEqual([1, 2, 3, 4]);
  });

  it("falls back to a single-row query for an id the database matched in another form", async () => {
    const whereIn = vi.fn(() => ({
      get: async () => [new Post({ id: 1, title: "a" }), new Post({ id: 5, title: "e" })],
    }));
    const first = vi.fn(async () => new Post({ id: 5, title: "e" }));

    vi.spyOn(Post, "query").mockReturnValue({
      whereIn,
      where: () => ({ first }),
    } as never);

    const [one, five] = await Promise.all([Post.find(1), Post.find("05")]);

    expect(whereIn).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(one?.get("title")).toBe("a");
    expect(five?.get("title")).toBe("e");
  });
});
