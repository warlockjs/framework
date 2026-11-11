import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../http/context/request-context";
import { CascadeAdapter } from "./adapters/cascade";
import { RepositoryManager } from "./repository.manager";

/**
 * Control options a request may not set through `list(request.all())`:
 * `paginate=false`, `purgeCache` and `cacheKey`. Server code (no request, or
 * a key the request did not send) keeps every option.
 */

function makeRepo(extra: Record<string, any> = {}) {
  const calls = { paginate: [] as any[], get: 0, limit: [] as number[] };
  const query: any = {
    where: () => query,
    applyFilters: () => query,
    limit: (n: number) => (calls.limit.push(n), query),
    orderBy: () => query,
    sortBy: () => query,
    select: () => query,
    first: async () => null,
    get: async () => (calls.get++, []),
    paginate: async (page: number, limit: number) => {
      calls.paginate.push({ page, limit });
      return { data: [{ page }], pagination: { page, limit } };
    },
    cursorPaginate: async (opts: any) => opts,
  };

  // Each spec gets its own class so the once-per-class warnings start fresh.
  class ProductsRepository extends RepositoryManager<any> {}

  const repo: any = Object.create(ProductsRepository.prototype);
  repo.filterBy = { category: "=" };
  repo.sortable = [];
  repo.selectable = [];
  repo.maxPerPage = 100;
  repo.defaultOptions = {};
  repo.isActiveColumn = "isActive";
  repo.newQuery = () => query;
  Object.assign(repo, extra);

  return { repo, calls };
}

/** Run `callback` inside an HTTP request whose input is `input`. */
function inRequest<T>(input: Record<string, any>, callback: () => Promise<T>): Promise<T> {
  return requestContext.run(
    { request: { all: () => input } as any, response: {} as any },
    callback,
  );
}

/** A plain Cascade adapter double: the framework is the only option reader. */
function cascadeAdapter() {
  const adapter: any = Object.create(CascadeAdapter.prototype);
  adapter.serializeModel = (model: any) => model;
  adapter.deserializeModel = (model: any) => model;
  adapter.resolveRepositoryName = () => "products";
  return adapter;
}

function withCache(repo: any, adapter = cascadeAdapter()) {
  const store = new Map<string, any>();

  repo.isCacheable = true;
  repo.cacheDriver = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: any) => void store.set(key, value),
  };
  Object.defineProperty(repo, "adapter", { value: adapter });

  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RepositoryManager: paginate=false from a request", () => {
  it("keeps the list paginated and capped at maxPerPage, and warns once", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo, calls } = makeRepo();

    await inRequest({ paginate: false }, async () => {
      await repo.list({ paginate: false });
      await repo.list({ paginate: false, limit: 5000 });
    });

    expect(calls.get).toBe(0);
    expect(calls.paginate).toEqual([
      { page: 1, limit: 15 },
      { page: 1, limit: 100 },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[2])).toContain("allowClientUnpaginated");
  });

  it("returns every row when the repository opts in", async () => {
    const { repo, calls } = makeRepo({ allowClientUnpaginated: true });

    await inRequest({ paginate: false }, async () => {
      await repo.list({ paginate: false });
    });

    expect(calls.get).toBe(1);
    expect(calls.paginate).toEqual([]);
  });

  it("honours paginate:false from server code outside a request", async () => {
    const { repo, calls } = makeRepo();

    await repo.list({ paginate: false });

    expect(calls.get).toBe(1);
    expect(calls.paginate).toEqual([]);
  });

  it("honours paginate:false that server code adds when the request did not send it", async () => {
    const { repo, calls } = makeRepo();

    await inRequest({ category: "shoes" }, async () => {
      await repo.list({ category: "shoes", paginate: false });
    });

    expect(calls.get).toBe(1);
  });

  it("honours paginate:false from server code when the request sent another value", async () => {
    const { repo, calls } = makeRepo();

    await inRequest({ paginate: true }, async () => {
      await repo.list({ paginate: false });
    });

    expect(calls.get).toBe(1);
  });

  it("honours a trusted default paginate:false", async () => {
    const { repo, calls } = makeRepo({ defaultOptions: { paginate: false } });

    await inRequest({ paginate: false }, async () => {
      await repo.list({ paginate: false });
    });

    expect(calls.get).toBe(1);
  });

  it("ignores a client perform value instead of crashing the query", async () => {
    const { repo, calls } = makeRepo();

    await inRequest({ perform: "1" }, async () => {
      await expect(repo.list({ perform: "1" })).resolves.toBeDefined();
    });

    expect(calls.paginate).toHaveLength(1);
  });
});

describe("RepositoryManager.listCached with request input", () => {
  it("keys the cache on declared filters and controls only", async () => {
    const { repo, calls } = makeRepo();
    const store = withCache(repo);

    await inRequest({ category: "shoes", x: "1" }, async () => {
      await repo.listCached({ category: "shoes", x: "1" });
    });
    await inRequest({ category: "shoes", x: "2" }, async () => {
      await repo.listCached({ category: "shoes", x: "2" });
    });

    expect(calls.paginate).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("keeps every option in the key when a function filter rule may read it", async () => {
    const { repo, calls } = makeRepo({ filterBy: { category: () => undefined } });
    const store = withCache(repo);

    await repo.listCached({ category: "shoes", locale: "en" });
    await repo.listCached({ category: "shoes", locale: "ar" });

    expect(calls.paginate).toHaveLength(2);
    expect(store.size).toBe(2);
  });

  it("does not let a request bypass the cache with purgeCache", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo, calls } = makeRepo();
    withCache(repo);

    await inRequest({ purgeCache: true }, async () => {
      await repo.listCached({ purgeCache: true });
      await repo.listCached({ purgeCache: true });
    });

    expect(calls.paginate).toHaveLength(1);
  });

  it("still lets server code refresh the cache with purgeCache", async () => {
    const { repo, calls } = makeRepo();
    withCache(repo);

    await repo.listCached({});
    await repo.listCached({ purgeCache: true });

    expect(calls.paginate).toHaveLength(2);
  });

  it("does not let a request-supplied cacheKey cache a callback-filtered list", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo, calls } = makeRepo();
    const store = withCache(repo);
    const perform = () => undefined;

    await inRequest({ cacheKey: "shared" }, async () => {
      await repo.listCached({ cacheKey: "shared", perform });
      await repo.listCached({ cacheKey: "shared", perform });
    });

    expect(store.size).toBe(0);
    expect(calls.paginate).toHaveLength(2);
  });
});
