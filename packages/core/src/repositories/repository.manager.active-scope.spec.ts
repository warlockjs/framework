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

describe("RepositoryManager *Active methods (B4)", () => {
  it("listActive applies the active column as a real where without a filterBy rule", async () => {
    const { repo, wheres } = makeRepo({ isActiveColumn: "status" });

    await repo.listActive({});

    expect(wheres).toContainEqual(["status", true]);
  });

  it("listActive({ isActive: false }) from a request cannot override the active filter", async () => {
    const { repo, wheres } = makeRepo();

    await repo.listActive({ isActive: false });

    expect(wheres).toContainEqual(["isActive", true]);
    expect(wheres).not.toContainEqual(["isActive", false]);
  });

  it("does not let a client smuggle an arbitrary activeScope", async () => {
    const { repo, wheres } = makeRepo();

    await repo.list({ activeScope: { role: "admin" } });

    expect(wheres).toEqual([]);
  });
});
