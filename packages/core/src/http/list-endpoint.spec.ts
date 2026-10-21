import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Request } from "./request";
import type { RepositoryManager } from "../repositories/repository.manager";
import type { PaginationResult } from "../repositories/contracts";
import { listEndpoint, type ListEndpointRepositoryOptions } from "./list-endpoint";

type Query = {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  status?: string;
  ignored?: string;
};
const pagination = { result: 1, total: 1, page: 2, limit: 100, pages: 1 };
const options = { pluralKey: "products", orderBy: ["createdAt"], filters: ["status"] } as const;

function repositoryList(
  repository: RepositoryManager<{ id: number }, { status?: string }>,
  cached: boolean,
) {
  return listEndpoint(
    { validated: (): Query => ({ status: "active" }) },
    (query) => (cached ? repository.listCached(query) : repository.list(query)),
    options,
  );
}

function requestList(
  request: Request<Query>,
  repository: RepositoryManager<{ id: number }, { status?: string }>,
) {
  return listEndpoint(request, (query) => repository.list(query), options);
}

describe("listEndpoint", () => {
  it("preserves item and plural-key types with both real repository methods", () => {
    expectTypeOf(requestList).returns.toMatchTypeOf<
      Promise<{
        products: { id: number }[];
        pagination: PaginationResult<{ id: number }>["pagination"];
      }>
    >();
    expectTypeOf(repositoryList).returns.toMatchTypeOf<
      Promise<{
        products: { id: number }[];
        pagination: PaginationResult<{ id: number }>["pagination"];
      }>
    >();
  });
  it("caps limits, maps ordering, forwards only allowed filters and rekeys results", async () => {
    const list = vi
      .fn<
        (options: ListEndpointRepositoryOptions<Query>) => Promise<PaginationResult<{ id: number }>>
      >()
      .mockResolvedValue({ data: [{ id: 1 }], pagination });
    const request = {
      validated: (): Query => ({
        page: 2,
        limit: 1000,
        orderBy: "createdAt",
        orderDir: "desc",
        status: "active",
        ignored: "secret",
      }),
    };
    expect(await listEndpoint(request, list, options)).toEqual({
      products: [{ id: 1 }],
      pagination,
    });
    expect(list).toHaveBeenCalledWith({
      page: 2,
      limit: 100,
      paginate: true,
      paginationMode: "pages",
      orderBy: ["createdAt", "desc"],
      status: "active",
    });
  });

  it("uses bounded defaults with a repository-shaped callback", async () => {
    const repository = { listCached: vi.fn().mockResolvedValue({ data: [], pagination }) };
    await listEndpoint({ validated: (): Query => ({}) }, (query) => repository.listCached(query), {
      ...options,
      maxLimit: 5,
    });
    expect(repository.listCached).toHaveBeenCalledWith({
      page: 1,
      limit: 5,
      paginate: true,
      paginationMode: "pages",
    });
  });

  it.each([{ page: 0 }, { limit: -1 }, { limit: NaN }, { page: 1.5 }, { orderBy: "privateField" }])(
    "rejects invalid controls before querying: %j",
    async (query) => {
      const list = vi.fn().mockResolvedValue({ data: [], pagination });
      await expect(
        listEndpoint({ validated: (): Query => query }, list, options),
      ).rejects.toMatchObject({ code: "invalidListQuery", status: 422 });
      expect(list).not.toHaveBeenCalled();
    },
  );
});
