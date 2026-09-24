import { describe, expect, it } from "vitest";
import { RepositoryManager } from "./repository.manager";

function makeRepo(extra: Record<string, any> = {}) {
  const wheres: any[] = [];
  const calls: Record<string, any[]> = {};
  const query: any = {
    where: (...args: any[]) => (wheres.push(args), query),
    applyFilters: () => query,
    limit: (n: number) => ((calls.limit ??= []).push(n), query),
    orderBy: (...args: any[]) => ((calls.orderBy ??= []).push(args), query),
    sortBy: (...args: any[]) => ((calls.sortBy ??= []).push(args), query),
    select: (...args: any[]) => ((calls.select ??= []).push(args), query),
    first: async () => null,
    get: async () => [],
    paginate: async (page: number, limit: number) => ({ page, limit }),
    cursorPaginate: async (opts: any) => opts,
  };
  const repo: any = Object.create(RepositoryManager.prototype);
  repo.filterBy = {};
  repo.sortable = [];
  repo.selectable = [];
  repo.maxPerPage = 100;
  repo.defaultOptions = {};
  repo.isActiveColumn = "isActive";
  repo.newQuery = () => query;
  Object.assign(repo, extra);
  return { repo, wheres, calls };
}

describe("RepositoryManager client control options (B7)", () => {
  it("ignores a client cursorColumn that is not whitelisted", async () => {
    const { repo, wheres } = makeRepo();

    await repo.list({ paginationMode: "cursor", cursorColumn: "reset_token", cursor: "a" });

    expect(wheres.some((w) => w[0] === "reset_token")).toBe(false);
  });

  it("caps limit and perPage at maxPerPage", async () => {
    const { repo } = makeRepo();

    const byLimit: any = await repo.list({ limit: 1000000 });
    const byPerPage: any = await repo.list({ perPage: 1e9 });

    expect(byLimit.limit).toBe(100);
    expect(byPerPage.limit).toBe(100);
  });

  it("drops orderBy on a column that is not sortable, keeps declared ones", async () => {
    const { repo, calls } = makeRepo({ sortable: ["name"] });

    await repo.list({ orderBy: { reset_token: "asc" } });
    expect(calls.sortBy).toBeUndefined();

    await repo.list({ orderBy: { name: "asc" } });
    expect(calls.sortBy).toHaveLength(1);
  });

  it("ignores a client select unless whitelisted", async () => {
    const { repo, calls } = makeRepo({ selectable: ["name"] });

    await repo.list({ select: ["password"] });
    expect(calls.select).toBeUndefined();

    await repo.list({ select: ["name", "password"] });
    expect(calls.select).toEqual([[["name"]]]);
  });
});
