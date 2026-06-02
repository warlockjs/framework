import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "../../../src/http";
import { Restful } from "../../../src/restful/restful";

/**
 * Direct-call unit coverage for the `Restful` base orchestration — the branch
 * logic the integration suite's happy path skips: the not-found guards, the
 * `callMiddleware` short-circuit, cache vs non-cache `find`, `bulkDelete` input
 * validation, and the `returnOn: "records"` redirect to `list`. Everything runs
 * over a hand-rolled repository + Request/Response stub, no Fastify, no DB.
 * Source: core/src/restful/restful.ts.
 */
type Row = { id: number; title: string };

/** Minimal mutable-model stub exposing the methods the restful paths call. */
function model(row: Row) {
  return {
    ...row,
    save: vi.fn(async function (this: Row, changes: Partial<Row> = {}) {
      Object.assign(this, changes);
      return this;
    }),
    destroy: vi.fn(async () => {}),
    clone() {
      return { ...this };
    },
  };
}

/** A repository stub; each method is a spy so call routing can be asserted. */
function makeRepository(rows: Row[] = [{ id: 1, title: "Alpha" }]) {
  return {
    rows,
    getCached: vi.fn(async (id: number) => {
      const row = rows.find((candidate) => candidate.id === Number(id));
      return row ? model(row) : null;
    }),
    find: vi.fn(async (id: number) => {
      const row = rows.find((candidate) => candidate.id === Number(id));
      return row ? model(row) : null;
    }),
    listCached: vi.fn(async () => ({ data: rows, pagination: { total: rows.length } })),
    list: vi.fn(async () => ({ data: rows, pagination: null })),
    newModel: vi.fn(() => model({ id: 0, title: "" })),
    create: vi.fn(async (data: Partial<Row>) => model({ id: 99, title: data.title ?? "" })),
    all: vi.fn(async () => rows.map((row) => model(row))),
  };
}

type ResponseStub = Response & {
  calls: Array<{ method: string; payload?: unknown }>;
};

/** Records each terminal response call and returns a sentinel for assertions. */
function makeResponse(): ResponseStub {
  const calls: Array<{ method: string; payload?: unknown }> = [];

  const record = (method: string) => (payload?: unknown) => {
    calls.push({ method, payload });
    return { method, payload };
  };

  return {
    calls,
    success: record("success"),
    successCreate: record("successCreate"),
    notFound: record("notFound"),
    badRequest: record("badRequest"),
    serverError: record("serverError"),
  } as unknown as ResponseStub;
}

/**
 * Structural Request stub. `inputs` seeds `input(key)` lookups; the bag getters
 * (`all` / `allExceptParams` / `heavy` / `heavyExceptParams`) return the matching
 * seed object or `{}`. Kept as closures so seed data never clobbers the methods.
 */
function makeRequest(
  seed: {
    inputs?: Record<string, any>;
    all?: Record<string, any>;
    allExceptParams?: Record<string, any>;
    heavy?: Record<string, any>;
    heavyExceptParams?: Record<string, any>;
  } = {},
): Request {
  return {
    input: (key: string) => seed.inputs?.[key],
    all: () => seed.all ?? {},
    allExceptParams: () => seed.allExceptParams ?? {},
    heavy: () => seed.heavy ?? {},
    heavyExceptParams: () => seed.heavyExceptParams ?? {},
  } as unknown as Request;
}

/** Build a concrete Restful subclass over the given repository + overrides. */
function makeResource(
  repository: ReturnType<typeof makeRepository>,
  config: Partial<{
    cache: boolean;
    returnOn: Record<string, "record" | "records">;
    middleware: Record<string, Array<(request: Request, response: Response) => any>>;
  }> = {},
) {
  class TestResource extends Restful<any> {
    protected repository = repository as any;
    public cache = config.cache ?? true;
    protected returnOn = config.returnOn ?? {
      create: "record",
      update: "record",
      delete: "record",
      patch: "record",
    };
    protected middleware = (config.middleware ?? {}) as any;
  }

  return new TestResource();
}

describe("Restful.find — cache routing", () => {
  it("uses getCached when cache is on", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository, { cache: true });

    await resource.find(1);

    expect(repository.getCached).toHaveBeenCalledWith(1);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it("uses find when cache is off", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository, { cache: false });

    await resource.find(1);

    expect(repository.find).toHaveBeenCalledWith(1);
    expect(repository.getCached).not.toHaveBeenCalled();
  });
});

describe("Restful.list", () => {
  it("returns records under the list name with pagination", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.list(makeRequest(), response);

    expect(response.calls[0].method).toBe("success");
    expect(response.calls[0].payload).toMatchObject({
      records: repository.rows,
      pagination: { total: 1 },
    });
  });

  it("coerces paginate='false' to a boolean false before querying", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const request = makeRequest({ heavy: { paginate: "false" } });

    await resource.list(request, makeResponse());

    expect(repository.listCached).toHaveBeenCalledWith({ paginate: false });
  });

  it("falls back to serverError when the repository throws", async () => {
    const repository = makeRepository();
    repository.listCached.mockRejectedValueOnce(new Error("db down"));
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.list(makeRequest(), response);

    expect(response.calls[0].method).toBe("serverError");
  });
});

describe("Restful.get", () => {
  it("returns the record under the record name", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.get(makeRequest({ inputs: { id: 1 } }), response);

    expect(response.calls[0].method).toBe("success");
    expect((response.calls[0].payload as { record: Row }).record.id).toBe(1);
  });

  it("returns notFound for a missing id", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.get(makeRequest({ inputs: { id: 404 } }), response);

    expect(response.calls[0].method).toBe("notFound");
  });
});

describe("Restful.create", () => {
  it("creates and returns the record via successCreate", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.create(makeRequest({ all: { title: "New" } }), response);

    expect(repository.create).toHaveBeenCalledWith({ title: "New" });
    expect(response.calls.at(-1)?.method).toBe("successCreate");
  });

  it("redirects to list when returnOn.create is 'records'", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository, {
      returnOn: { create: "records", update: "record", delete: "record", patch: "record" },
    });
    const response = makeResponse();

    await resource.create(makeRequest({ all: { title: "X" } }), response);

    // The list path emits success (not successCreate) and queries the repo list.
    expect(repository.listCached).toHaveBeenCalled();
    expect(response.calls.at(-1)?.method).toBe("success");
  });

  it("returns badRequest when create throws", async () => {
    const repository = makeRepository();
    repository.create.mockRejectedValueOnce(new Error("validation failed"));
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.create(makeRequest({ all: {} }), response);

    expect(response.calls.at(-1)).toMatchObject({
      method: "badRequest",
      payload: { error: "validation failed" },
    });
  });
});

describe("Restful.update / delete — not found guards", () => {
  it("update returns notFound for a missing record", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.update(makeRequest({ inputs: { id: 404 } }), response);

    expect(response.calls[0].method).toBe("notFound");
  });

  it("delete returns notFound for a missing record", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.delete(makeRequest({ inputs: { id: 404 } }), response);

    expect(response.calls[0].method).toBe("notFound");
  });

  it("delete destroys the record and returns success", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.delete(makeRequest({ inputs: { id: 1 } }), response);

    expect(response.calls.at(-1)?.method).toBe("success");
  });
});

describe("Restful.bulkDelete", () => {
  it("returns badRequest when id is not an array", async () => {
    const repository = makeRepository();
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.bulkDelete(makeRequest({ inputs: { id: "not-array" } }), response);

    expect(response.calls[0]).toMatchObject({
      method: "badRequest",
      payload: { error: "id must be an array" },
    });
  });

  it("deletes every matched record and reports the count", async () => {
    const repository = makeRepository([
      { id: 1, title: "A" },
      { id: 2, title: "B" },
    ]);
    const resource = makeResource(repository);
    const response = makeResponse();

    await resource.bulkDelete(makeRequest({ inputs: { id: ["1", "2"] } }), response);

    expect(repository.all).toHaveBeenCalled();
    expect(response.calls.at(-1)).toMatchObject({ method: "success", payload: { deleted: 2 } });
  });
});

describe("Restful — middleware short-circuit", () => {
  it("list returns early when a middleware produces output", async () => {
    const repository = makeRepository();
    const guard = vi.fn(() => ({ blocked: true }));
    const resource = makeResource(repository, { middleware: { list: [guard] } });
    const response = makeResponse();

    await resource.list(makeRequest(), response);

    expect(guard).toHaveBeenCalled();
    // Short-circuited before the repository was queried.
    expect(repository.listCached).not.toHaveBeenCalled();
    expect(response.calls).toHaveLength(0);
  });

  it("get proceeds when middleware returns nothing", async () => {
    const repository = makeRepository();
    const pass = vi.fn(() => undefined);
    const resource = makeResource(repository, { middleware: { get: [pass] } });
    const response = makeResponse();

    await resource.get(makeRequest({ inputs: { id: 1 } }), response);

    expect(pass).toHaveBeenCalled();
    expect(response.calls[0].method).toBe("success");
  });
});
