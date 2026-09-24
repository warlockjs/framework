import { describe, expect, it, vi } from "vitest";
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
    const { resource, repository, record } = build({ validation: { all: {} } });

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
