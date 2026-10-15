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

describe("RepositoryManager lookups with undeclared filter keys (B3)", () => {
  it("exists({ email }) filters by email even when filterBy lacks it", async () => {
    const { repo, wheres } = makeRepo();

    await repo.exists({ email: "a@b.c" });

    expect(wheres).toContainEqual(["email", "a@b.c"]);
  });

  it("updateOrCreate({ email }) looks up by email, not the first row", async () => {
    const { repo, wheres } = makeRepo();
    repo.create = async (data: any) => data;

    await repo.updateOrCreate({ email: "a@b.c" }, { name: "x" });

    expect(wheres).toContainEqual(["email", "a@b.c"]);
  });

  it("findOrCreate({ email }) looks up by email", async () => {
    const { repo, wheres } = makeRepo();
    repo.create = async (data: any) => data;

    await repo.findOrCreate({ email: "a@b.c" }, { name: "x" });

    expect(wheres).toContainEqual(["email", "a@b.c"]);
  });

  it("rejects operator objects as lookup values", async () => {
    const { repo } = makeRepo();

    await expect(repo.first({ email: { $ne: "" } })).rejects.toThrow();
  });
});
