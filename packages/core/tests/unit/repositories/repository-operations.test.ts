import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CursorPaginationResult,
  PaginationResult,
  QueryBuilderContract,
  RepositoryAdapterContract,
} from "../../../src/repositories/contracts";
import { RepositoryManager } from "../../../src/repositories/repository.manager";

/**
 * Repository CRUD / read / cached behavior WITHOUT a database. The adapter and
 * query builder are vi.fn mocks, and caching is exercised against an in-memory
 * fake cache driver. This pins the repository's delegation, option-composition,
 * pagination-mode routing, and cache read-through logic.
 *
 * DB IS MOCKED — there is no real Mongo/Postgres here (Docker was unavailable).
 *
 * Source: core/src/repositories/repository.manager.ts.
 */

type Row = { id: number; name?: string; isActive?: boolean };

/** Chainable query mock — every builder method returns `this`; terminals are stubbable. */
function makeQuery() {
  const query: any = {
    where: vi.fn(() => query),
    orWhere: vi.fn(() => query),
    whereIn: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    sortBy: vi.fn(() => query),
    random: vi.fn(() => query),
    select: vi.fn(() => query),
    deselect: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => query),
    skip: vi.fn(() => query),
    applyFilters: vi.fn(() => query),
    get: vi.fn(async () => [] as Row[]),
    first: vi.fn(async () => null as Row | null),
    count: vi.fn(async () => 0),
    paginate: vi.fn(async () => ({
      data: [],
      pagination: { limit: 15, result: 0, page: 1, total: 0, pages: 0 },
    })),
    cursorPaginate: vi.fn(async () => ({
      data: [],
      pagination: { limit: 15, result: 0, hasMore: false },
    })),
    chunk: vi.fn(async () => undefined),
    clone: vi.fn(() => query),
  };

  return query;
}

function makeAdapter(query: any): RepositoryAdapterContract<Row> {
  return {
    query: vi.fn(() => query as QueryBuilderContract<Row>),
    registerEvents: vi.fn(() => []),
    resolveRepositoryName: vi.fn(() => "rows"),
    serializeModel: vi.fn((model: Row) => ({ ...model, __serialized: true })),
    deserializeModel: vi.fn((data: any) => ({ id: data.id, name: data.name })),
    find: vi.fn(async () => null),
    findBy: vi.fn(async () => null),
    create: vi.fn(async (data: any) => ({ id: 1, ...data })),
    update: vi.fn(async (id: any, data: any) => ({ id, ...data })),
    delete: vi.fn(async () => undefined),
    updateMany: vi.fn(async () => 0),
    deleteMany: vi.fn(async () => 0),
    count: vi.fn(async () => 0),
    paginate: vi.fn(async () => ({}) as PaginationResult<Row>),
    cursorPaginate: vi.fn(async () => ({}) as CursorPaginationResult<Row>),
    chunk: vi.fn(async () => undefined),
    createModel: vi.fn((data: any) => data as Row),
  } as unknown as RepositoryAdapterContract<Row>;
}

/** In-memory cache driver — minimal surface the repository touches. */
function makeCache() {
  const store = new Map<string, any>();

  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : undefined)),
    set: vi.fn(async (key: string, value: any) => {
      store.set(key, value);
    }),
    removeNamespace: vi.fn(async (namespace: string) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(namespace)) {
          store.delete(key);
        }
      }
    }),
    flush: vi.fn(async () => store.clear()),
  };
}

/** Test subclass that injects a cache and lets tests flip the repository name. */
class TestRepository extends RepositoryManager<Row> {
  public constructor(adapter: RepositoryAdapterContract<Row>, cacheDriver?: any) {
    super(adapter);

    this.name = "rows";

    if (cacheDriver) {
      this.cacheDriver = cacheDriver;
      this.isCacheable = true;
    }
  }
}

let query: any;
let adapter: RepositoryAdapterContract<Row>;

beforeEach(() => {
  query = makeQuery();
  adapter = makeAdapter(query);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RepositoryManager — CRUD delegation", () => {
  it("create delegates to the adapter", async () => {
    const repository = new TestRepository(adapter);

    const created = await repository.create({ name: "Ada" });

    expect(adapter.create).toHaveBeenCalledWith({ name: "Ada" });
    expect(created).toEqual({ id: 1, name: "Ada" });
  });

  it("update delegates to the adapter", async () => {
    const repository = new TestRepository(adapter);

    await repository.update(5, { name: "Grace" });

    expect(adapter.update).toHaveBeenCalledWith(5, { name: "Grace" });
  });

  it("delete delegates to the adapter", async () => {
    const repository = new TestRepository(adapter);

    await repository.delete(9);

    expect(adapter.delete).toHaveBeenCalledWith(9);
  });

  it("updateMany / deleteMany delegate to the adapter", async () => {
    const repository = new TestRepository(adapter);

    await repository.updateMany({ isActive: false }, { archived: true });
    await repository.deleteMany({ isActive: false });

    expect(adapter.updateMany).toHaveBeenCalledWith({ isActive: false }, { archived: true });
    expect(adapter.deleteMany).toHaveBeenCalledWith({ isActive: false });
  });
});

describe("RepositoryManager — finding", () => {
  it("find delegates to the adapter", async () => {
    (adapter.find as any).mockResolvedValueOnce({ id: 3, name: "x" });
    const repository = new TestRepository(adapter);

    expect(await repository.find(3)).toEqual({ id: 3, name: "x" });
    expect(adapter.find).toHaveBeenCalledWith(3);
  });

  it("findBy delegates to the adapter", async () => {
    const repository = new TestRepository(adapter);

    await repository.findBy("email", "a@b.com");

    expect(adapter.findBy).toHaveBeenCalledWith("email", "a@b.com");
  });

  it("findActive builds an id + active filter query", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 1, isActive: true });
    const repository = new TestRepository(adapter);

    const found = await repository.findActive(1);

    expect(query.where).toHaveBeenCalledWith({ id: 1, isActive: true });
    expect(found).toEqual({ id: 1, isActive: true });
  });

  it("findByActive builds a column + active filter query", async () => {
    const repository = new TestRepository(adapter);

    await repository.findByActive("slug", "hello");

    expect(query.where).toHaveBeenCalledWith({ slug: "hello", isActive: true });
  });

  it("first applies options and limits to one", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 7 });
    const repository = new TestRepository(adapter);

    const row = await repository.first({ select: ["id"] });

    expect(query.select).toHaveBeenCalledWith(["id"]);
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(row).toEqual({ id: 7 });
  });

  it("firstId returns the id of the first match", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 42 });
    const repository = new TestRepository(adapter);

    expect(await repository.firstId()).toBe(42);
  });
});

describe("RepositoryManager — listing & pagination", () => {
  it("list defaults to page-based pagination", async () => {
    const repository = new TestRepository(adapter);

    await repository.list({ page: 2, limit: 10 });

    expect(query.paginate).toHaveBeenCalledWith(2, 10);
    expect(query.cursorPaginate).not.toHaveBeenCalled();
  });

  it("list uses cursorPaginate in cursor mode", async () => {
    const repository = new TestRepository(adapter);

    await repository.list({
      paginationMode: "cursor",
      limit: 20,
      cursor: 100,
      direction: "next",
    });

    expect(query.cursorPaginate).toHaveBeenCalledWith({
      limit: 20,
      cursor: 100,
      direction: "next",
      cursorColumn: undefined,
    });
    expect(query.paginate).not.toHaveBeenCalled();
  });

  it("list falls back to defaultLimit when no limit is given", async () => {
    const repository = new TestRepository(adapter);

    await repository.list({ page: 1, defaultLimit: 25 });

    expect(query.paginate).toHaveBeenCalledWith(1, 25);
  });

  it("all executes get() with applied options", async () => {
    (query.get as any).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const repository = new TestRepository(adapter);

    const rows = await repository.all({ orderBy: ["id", "desc"] });

    expect(query.orderBy).toHaveBeenCalledWith("id", "desc");
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("latest orders by id desc; oldest orders by id asc", async () => {
    const repository = new TestRepository(adapter);

    await repository.latest();
    expect(query.orderBy).toHaveBeenCalledWith("id", "desc");

    await repository.oldest();
    expect(query.orderBy).toHaveBeenCalledWith("id", "asc");
  });
});

describe("RepositoryManager — count & existence", () => {
  it("count delegates to query.count()", async () => {
    (query.count as any).mockResolvedValueOnce(99);
    const repository = new TestRepository(adapter);

    expect(await repository.count()).toBe(99);
  });

  it("exists is true when first returns a row", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 1 });
    const repository = new TestRepository(adapter);

    expect(await repository.exists()).toBe(true);
  });

  it("exists is false when first returns null", async () => {
    (query.first as any).mockResolvedValueOnce(null);
    const repository = new TestRepository(adapter);

    expect(await repository.exists()).toBe(false);
  });

  it("idExists delegates to find", async () => {
    (adapter.find as any).mockResolvedValueOnce({ id: 4 });
    const repository = new TestRepository(adapter);

    expect(await repository.idExists(4)).toBe(true);
  });
});

describe("RepositoryManager — findOrCreate / updateOrCreate", () => {
  it("findOrCreate returns the existing record without creating", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 1, name: "exists" });
    const repository = new TestRepository(adapter);

    const row = await repository.findOrCreate({ name: "exists" }, { name: "exists" });

    expect(row).toEqual({ id: 1, name: "exists" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("findOrCreate creates when nothing matches", async () => {
    (query.first as any).mockResolvedValueOnce(null);
    const repository = new TestRepository(adapter);

    await repository.findOrCreate({ name: "new" }, { name: "new" });

    expect(adapter.create).toHaveBeenCalledWith({ name: "new" });
  });

  it("updateOrCreate updates an existing record", async () => {
    (query.first as any).mockResolvedValueOnce({ id: 5, name: "old" });
    const repository = new TestRepository(adapter);

    await repository.updateOrCreate({ id: 5 } as any, { name: "fresh" });

    expect(adapter.update).toHaveBeenCalledWith({ id: 5, name: "old" }, { name: "fresh" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("updateOrCreate creates when nothing matches", async () => {
    (query.first as any).mockResolvedValueOnce(null);
    const repository = new TestRepository(adapter);

    await repository.updateOrCreate({ id: 99 } as any, { name: "brand-new" });

    expect(adapter.create).toHaveBeenCalledWith({ name: "brand-new" });
  });
});

describe("RepositoryManager — chunking", () => {
  it("chunk forwards size + callback to the query", async () => {
    const repository = new TestRepository(adapter);
    const callback = vi.fn(async () => undefined);

    await repository.chunk(100, callback);

    expect(query.chunk).toHaveBeenCalledWith(100, callback);
  });
});

describe("RepositoryManager — cached reads", () => {
  it("countCached caches a miss then serves the hit", async () => {
    const cache = makeCache();
    (query.count as any).mockResolvedValue(7);
    const repository = new TestRepository(adapter, cache);

    const first = await repository.countCached();

    expect(first).toBe(7);
    expect(query.count).toHaveBeenCalledTimes(1);

    const second = await repository.countCached();

    expect(second).toBe(7);
    // No second DB count — served from cache.
    expect(query.count).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith("repositories.rows.count.{}", 7);
  });

  it("allCached serializes on store and deserializes on hit", async () => {
    const cache = makeCache();
    (query.get as any).mockResolvedValue([{ id: 1, name: "a" }]);
    const repository = new TestRepository(adapter, cache);

    await repository.allCached();

    expect(adapter.serializeModel).toHaveBeenCalledWith({ id: 1, name: "a" });

    const hit = await repository.allCached();

    expect(adapter.deserializeModel).toHaveBeenCalled();
    expect(hit).toEqual([{ id: 1, name: "a" }]);
    // Only one underlying query — the second call hit the cache.
    expect(query.get).toHaveBeenCalledTimes(1);
  });

  it("getCachedBy caches the model under a column.value key", async () => {
    const cache = makeCache();
    (adapter.findBy as any).mockResolvedValue({ id: 1, name: "ada" });
    const repository = new TestRepository(adapter, cache);

    await repository.getCachedBy("email", "ada@x.com");

    expect(cache.set).toHaveBeenCalledWith(
      "repositories.rows.email.ada@x.com",
      expect.objectContaining({ __serialized: true }),
    );

    const hit = await repository.getCachedBy("email", "ada@x.com");

    expect(hit).toEqual({ id: 1, name: "ada" });
    expect(adapter.findBy).toHaveBeenCalledTimes(1);
  });

  it("listCached stores data + pagination and rehydrates on hit", async () => {
    const cache = makeCache();
    (query.paginate as any).mockResolvedValue({
      data: [{ id: 1, name: "x" }],
      pagination: { limit: 15, result: 1, page: 1, total: 1, pages: 1 },
    });
    const repository = new TestRepository(adapter, cache);

    const first = await repository.listCached({ page: 1 });

    expect(first.data).toEqual([{ id: 1, name: "x" }]);

    const second = await repository.listCached({ page: 1 });

    expect(second.pagination.total).toBe(1);
    expect(query.paginate).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when isCacheable is false", async () => {
    const cache = makeCache();
    (query.count as any).mockResolvedValue(3);
    const repository = new TestRepository(adapter, cache);
    (repository as any).isCacheable = false;

    await repository.countCached();
    await repository.countCached();

    // Cache never consulted; both calls hit the query.
    expect(cache.get).not.toHaveBeenCalled();
    expect(query.count).toHaveBeenCalledTimes(2);
  });
});

describe("RepositoryManager — cache invalidation", () => {
  it("clearCache removes the repository namespace", async () => {
    const cache = makeCache();
    const repository = new TestRepository(adapter, cache);

    await repository.clearCache();

    expect(cache.removeNamespace).toHaveBeenCalledWith("repositories.rows");
  });

  it("clearModelCache targets the model's id namespace", async () => {
    const cache = makeCache();
    const repository = new TestRepository(adapter, cache);

    await repository.clearModelCache({ id: 7 } as Row);

    expect(cache.removeNamespace).toHaveBeenCalledWith("repositories.rows.id.7");
  });
});

describe("RepositoryManager — name resolution", () => {
  it("falls back to the adapter's repository name", () => {
    const repository = new TestRepository(adapter);
    (repository as any).name = undefined;

    expect(repository.getName()).toBe("rows");
    expect(adapter.resolveRepositoryName).toHaveBeenCalled();
  });
});
