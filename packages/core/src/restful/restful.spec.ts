import { describe, expect, it, vi } from "vitest";
import { requestContext } from "../http/context/request-context";
import { RepositoryManager } from "../repositories/repository.manager";
import { Restful } from "./restful";

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const makeResponse = () =>
  ({
    success: vi.fn((body) => ({ status: 200, body })),
    successCreate: vi.fn((body) => ({ status: 201, body })),
    forbidden: vi.fn(() => ({ status: 403 })),
    notFound: vi.fn(() => ({ status: 404 })),
    badRequest: vi.fn((body) => ({ status: 400, body })),
  }) as any;

const makeRequest = () =>
  ({
    input: () => 1,
    all: () => ({ name: "a", role: "admin" }),
    allExceptParams: () => ({ name: "a", role: "admin" }),
    heavyExceptParams: () => ({ name: "a", role: "admin" }),
    validated: () => ({ name: "a" }),
  }) as any;

const makeRecord = () => ({ save: vi.fn(async () => undefined), clone: () => ({}) });

function build(overrides: Record<string, any> = {}, record = makeRecord()) {
  const repository: any = {
    newModel: () => record,
    create: vi.fn(async (data) => data),
    getCached: vi.fn(async () => record),
    find: vi.fn(async () => record),
  };

  class Users extends Restful<any> {
    protected repository = repository;
  }

  const resource: any = new Users();
  Object.assign(resource, overrides);

  return { resource, repository, record };
}

describe("Restful", () => {
  it("B4: persists only validated input when a schema exists, `role: admin` is dropped", async () => {
    const { resource, record } = build({ validation: { all: {} } });

    await resource.create({ request: makeRequest(), response: makeResponse() });
    expect(record.save).toHaveBeenCalledWith({ name: "a" });

    await resource.update({ request: makeRequest(), response: makeResponse() });
    expect(record.save).toHaveBeenCalledWith({ name: "a" });

    await resource.patch({ request: makeRequest(), response: makeResponse() });
    expect(record.save).toHaveBeenLastCalledWith({ name: "a" });
  });

  it("B5: runs the middleware map for create/update/patch/delete", async () => {
    const guard = vi.fn(async ({ response }) => response.forbidden());
    const { resource, repository, record } = build({
      middleware: { create: [guard], update: [guard], patch: [guard], delete: [guard] },
    });
    const response = makeResponse();

    for (const action of ["create", "update", "patch", "delete"]) {
      const output = await resource[action]({ request: makeRequest(), response });
      expect(output).toEqual({ status: 403 });
    }

    expect(guard).toHaveBeenCalledTimes(4);
    expect(repository.create).not.toHaveBeenCalled();
    expect(record.save).not.toHaveBeenCalled();
  });

  it("B6: a database error propagates instead of resolving undefined", async () => {
    const record = makeRecord();
    record.save = vi.fn(async () => {
      throw new Error("db down");
    });
    const { resource, repository } = build({}, record);

    await expect(
      resource.update({ request: makeRequest(), response: makeResponse() }),
    ).rejects.toThrow("db down");
    await expect(
      resource.patch({ request: makeRequest(), response: makeResponse() }),
    ).rejects.toThrow("db down");

    repository.getCached = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(
      resource.get({ request: makeRequest(), response: makeResponse() }),
    ).rejects.toThrow("db down");
  });

  it("B7: a refusing beforePatch/beforeSave stops the patch save", async () => {
    const response = makeResponse();

    const a = build({ beforePatch: async () => response.forbidden() });
    await a.resource.patch({ request: makeRequest(), response });
    expect(a.record.save).not.toHaveBeenCalled();

    const b = build({ beforeSave: async () => response.forbidden() });
    const output = await b.resource.patch({ request: makeRequest(), response });
    expect(output).toEqual({ status: 403 });
    expect(b.record.save).not.toHaveBeenCalled();
  });
});

describe("Restful.list with client controls", () => {
  /** A real repository over a fake query that "holds" maxPerPage + 1 rows. */
  function realRepository() {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }));
    const query: any = {
      where: () => query,
      applyFilters: () => query,
      limit: (n: number) => ((query.limited = n), query),
      orderBy: () => query,
      sortBy: () => query,
      select: () => query,
      get: async () => rows.slice(0, query.limited ?? rows.length),
      paginate: async (page: number, limit: number) => ({
        data: rows.slice(0, limit),
        pagination: { page, limit },
      }),
    };

    class Products extends RepositoryManager<any> {}

    const repository: any = Object.create(Products.prototype);
    Object.assign(repository, {
      filterBy: {},
      sortable: [],
      selectable: [],
      maxPerPage: 100,
      defaultOptions: {},
      isCacheable: false,
      newQuery: () => query,
    });

    return repository;
  }

  it("returns at most maxPerPage records for ?paginate=false, ?perform=1 and ?purgeCache=1", async () => {
    const repository = realRepository();
    const input = { paginate: "false", perform: "1", purgeCache: "1", limit: "500" };
    const request: any = { heavy: () => ({ ...input }), all: () => input };
    const response = makeResponse();

    class Products extends Restful<any> {
      protected repository = repository;
    }

    const resource: any = new Products();
    resource.cache = false;

    const output: any = await requestContext.run({ request, response }, () =>
      resource.list({ request, response }),
    );

    expect(output.status).toBe(200);
    expect(output.body.records).toHaveLength(100);
    expect(output.body.pagination).toEqual({ page: 1, limit: 100 });
  });
});

describe("Restful.bulkDelete bounds", () => {
  const bulkRequest = (ids: unknown[]) => ({ input: () => ids }) as any;

  it("refuses more ids than bulkDeleteLimit with 400 before loading records", async () => {
    const all = vi.fn(async () => []);
    const { resource, repository } = build({ bulkDeleteLimit: 100 });
    repository.all = all;
    const response = makeResponse();

    const ids = Array.from({ length: 1000 }, (_, index) => index + 1);
    const output = await resource.bulkDelete({ request: bulkRequest(ids), response });

    expect(output.status).toBe(400);
    expect(String(output.body.error)).toContain("bulkDeleteLimit");
    expect(all).not.toHaveBeenCalled();
  });

  it("deletes at most bulkDeleteConcurrency records at the same time", async () => {
    let inFlight = 0;
    let peak = 0;
    const records = Array.from({ length: 25 }, () => ({
      destroy: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
      }),
    }));

    const { resource, repository } = build({ bulkDeleteConcurrency: 4 });
    repository.all = vi.fn(async () => records);

    const output = await resource.bulkDelete({
      request: bulkRequest(records.map((_, index) => index + 1)),
      response: makeResponse(),
    });

    expect(output.body).toEqual({ deleted: 25 });
    expect(records.every((record) => record.destroy.mock.calls.length === 1)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
