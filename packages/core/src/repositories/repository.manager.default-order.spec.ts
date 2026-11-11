import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { RepositoryManager } from "./repository.manager";

function makeRepo(extra: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {};
  const query: any = {
    where: () => query,
    applyFilters: () => query,
    limit: (n: number) => ((calls.limit ??= []).push(n), query),
    orderBy: (...args: any[]) => ((calls.orderBy ??= []).push(args), query),
    sortBy: (...args: any[]) => ((calls.sortBy ??= []).push(args), query),
    select: () => query,
    first: async () => null,
    get: async () => [],
    paginate: async (page: number, limit: number) => ({ page, limit }),
    cursorPaginate: async (opts: any) => opts,
  };
  // A fresh subclass per repo: the dropped-order warning is deduped per class.
  const repo: any = Object.create(class extends RepositoryManager<any> {}.prototype);
  repo.filterBy = {};
  repo.sortable = [];
  repo.selectable = [];
  repo.maxPerPage = 100;
  repo.defaultOptions = {};
  repo.isActiveColumn = "isActive";
  repo.newQuery = () => query;
  Object.assign(repo, extra);
  return { repo, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RepositoryManager default orderBy", () => {
  it("applies the repository default orderBy even when no column is sortable", async () => {
    const { repo, calls } = makeRepo({ defaultOptions: { orderBy: { created_at: "desc" } } });

    await repo.list({});

    expect(calls.sortBy).toEqual([[{ created_at: "desc" }]]);
  });

  it("applies the config default orderBy", async () => {
    vi.spyOn(config, "get").mockImplementation(((key: string) =>
      key === "repository.defaultOptions"
        ? { orderBy: { created_at: "desc" } }
        : undefined) as never);
    const { repo, calls } = makeRepo();

    await repo.list();

    expect(calls.sortBy).toEqual([[{ created_at: "desc" }]]);
  });

  it("drops a caller orderBy on a non-sortable column and applies the default", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo, calls } = makeRepo({
      sortable: ["name"],
      defaultOptions: { orderBy: { created_at: "desc" } },
    });

    await repo.list({ orderBy: { secret_col: "asc", name: "asc" } });

    expect(calls.sortBy).toEqual([[{ created_at: "desc" }]]);
  });

  it("an allowed caller orderBy overrides the default", async () => {
    const { repo, calls } = makeRepo({
      sortable: ["name"],
      defaultOptions: { orderBy: { created_at: "desc" } },
    });

    await repo.list({ orderBy: { name: "asc" } });

    expect(calls.sortBy).toEqual([[{ name: "asc" }]]);
  });

  it("a valid caller sortBy is not overridden by the default orderBy", async () => {
    const { repo, calls } = makeRepo({
      sortable: ["name"],
      defaultOptions: { orderBy: { created_at: "desc" } },
    });

    await repo.list({ sortBy: "name", sortDirection: "asc" });

    expect(calls.sortBy).toBeUndefined();
    expect(calls.orderBy).toEqual([["name", "asc"]]);
  });

  it("with no default, a dropped caller orderBy leaves no order", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo, calls } = makeRepo();

    await repo.list({ orderBy: { hidden_a: "asc" } });

    expect(calls.sortBy).toBeUndefined();
    expect(calls.orderBy).toBeUndefined();
  });

  it("warns once per repository class and dropped column set, naming the order that applies", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);
    const { repo } = makeRepo({ defaultOptions: { orderBy: { created_at: "desc" } } });

    await repo.list({ orderBy: { hidden_b: "asc" } });
    await repo.list({ orderBy: { hidden_b: "desc" } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[2])).toContain('"hidden_b"');
    expect(String(warn.mock.calls[0]?.[2])).toContain("default orderBy applies instead");

    await repo.list({ orderBy: { hidden_c: "asc" } });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("still caps limit, perPage and defaultLimit at maxPerPage, defaults included", async () => {
    const { repo } = makeRepo({ defaultOptions: { limit: 5000, defaultLimit: 9000 } });

    const byDefault: any = await repo.list({});
    const byCaller: any = await repo.list({ perPage: 1e9 });

    expect(byDefault.limit).toBe(100);
    expect(byCaller.limit).toBe(100);
  });
});
