import { afterEach, describe, expect, it } from "vitest";
import { Restful } from "../../../src/restful/restful";
import type { Request, Response } from "../../../src/http";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * The restful resource chain over the live path: `router.restfulResource()`
 * registers list/show/create/update/destroy and each one responds through the
 * real request lifecycle. The repository is stubbed in memory — no database —
 * so the test exercises wiring + response shaping, not persistence.
 */

type RecordRow = { id: number; title: string };

/**
 * In-memory stand-in for a `RepositoryManager`. Implements only the surface the
 * `Restful` base touches for the actions under test (find/list/create/destroy),
 * returning plain rows with the minimal model shape (`save`, `destroy`,
 * `clone`) the update/delete paths call.
 */
class InMemoryRepository {
  public rows: RecordRow[] = [
    { id: 1, title: "Alpha" },
    { id: 2, title: "Beta" },
  ];

  private nextId = 3;

  public async listCached() {
    return { data: this.rows, pagination: { total: this.rows.length } };
  }

  public async getCached(id: string | number) {
    const row = this.rows.find((candidate) => candidate.id === Number(id));

    if (!row) return null;

    return this.decorate(row);
  }

  public newModel(data?: Partial<RecordRow>) {
    return this.decorate({ id: 0, title: "", ...data } as RecordRow);
  }

  public async create(data: Partial<RecordRow>) {
    const row: RecordRow = { id: this.nextId++, title: data.title ?? "" };

    this.rows.push(row);

    return this.decorate(row);
  }

  /**
   * Wrap a row with the minimal mutable-model methods the restful update and
   * delete paths invoke. Persistence is faked against the in-memory array.
   */
  private decorate(row: RecordRow) {
    const repository = this;

    return {
      ...row,
      async save(changes: Partial<RecordRow> = {}) {
        Object.assign(this, changes);

        return this;
      },
      async destroy() {
        repository.rows = repository.rows.filter((candidate) => candidate.id !== row.id);
      },
      clone() {
        return { ...this };
      },
    };
  }
}

/**
 * Concrete resource binding the in-memory repository, used to drive the full
 * CRUD route chain. `cache = true` so the base calls the `*Cached` repository
 * methods the stub implements.
 */
class RecordsResource extends Restful<any> {
  protected repository = new InMemoryRepository() as any;

  public cache = true;

  /**
   * Expose the underlying rows so assertions can confirm side effects of
   * create / delete without a second request.
   */
  public get rows(): RecordRow[] {
    return (this.repository as unknown as InMemoryRepository).rows;
  }
}

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("HTTP restful — CRUD chain", () => {
  it("GET /records lists records with pagination", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/records", new RecordsResource(), { name: "records" });
    });

    const result = await harness.inject({ method: "GET", url: "/records" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({
      records: [
        { id: 1, title: "Alpha" },
        { id: 2, title: "Beta" },
      ],
      pagination: { total: 2 },
    });
  });

  it("GET /records/:id returns a single record", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/records", new RecordsResource(), { name: "records" });
    });

    const result = await harness.inject({ method: "GET", url: "/records/1" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result).record).toMatchObject({ id: 1, title: "Alpha" });
  });

  it("GET /records/:id returns 404 for a missing record", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/records", new RecordsResource(), { name: "records" });
    });

    const result = await harness.inject({ method: "GET", url: "/records/999" });

    expect(result.statusCode).toBe(404);
  });

  it("POST /records creates a record and returns 201", async () => {
    const resource = new RecordsResource();

    harness = await bootHarness((router) => {
      router.restfulResource("/records", resource, { name: "records" });
    });

    const result = await harness.inject({
      method: "POST",
      url: "/records",
      payload: { title: "Gamma" },
    });

    expect(result.statusCode).toBe(201);
    expect(harness.json(result).record).toMatchObject({ title: "Gamma" });
    expect(resource.rows.some((row) => row.title === "Gamma")).toBe(true);
  });

  it("PUT /records/:id updates a record and returns 200", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/records", new RecordsResource(), { name: "records" });
    });

    const result = await harness.inject({
      method: "PUT",
      url: "/records/1",
      payload: { title: "Alpha Updated" },
    });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result).record).toMatchObject({ id: 1, title: "Alpha Updated" });
  });

  it("DELETE /records/:id destroys a record and returns 200", async () => {
    const resource = new RecordsResource();

    harness = await bootHarness((router) => {
      router.restfulResource("/records", resource, { name: "records" });
    });

    const result = await harness.inject({ method: "DELETE", url: "/records/1" });

    expect(result.statusCode).toBe(200);
    expect(resource.rows.some((row) => row.id === 1)).toBe(false);
  });

  it("DELETE /records/:id returns 404 for a missing record", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/records", new RecordsResource(), { name: "records" });
    });

    const result = await harness.inject({ method: "DELETE", url: "/records/999" });

    expect(result.statusCode).toBe(404);
  });
});

describe("HTTP restful — only / except shaping", () => {
  it("registers only the listed actions", async () => {
    harness = await bootHarness((router) => {
      router.restfulResource("/read-only", new RecordsResource(), {
        name: "readOnly",
        only: ["list", "get"],
      });
    });

    const list = await harness.inject({ method: "GET", url: "/read-only" });
    const create = await harness.inject({ method: "POST", url: "/read-only", payload: { title: "X" } });

    expect(list.statusCode).toBe(200);
    // create was never registered → Fastify miss.
    expect(create.statusCode).toBe(404);
  });
});

describe("HTTP restful — custom Restful subclass", () => {
  it("runs a per-method middleware hook that short-circuits", async () => {
    class GuardedResource extends Restful<any> {
      protected repository = new InMemoryRepository() as any;

      public cache = true;

      protected middleware = {
        get: [
          (_request: Request, response: Response) => response.forbidden({ error: "no peeking" }),
        ],
      } as any;
    }

    harness = await bootHarness((router) => {
      router.restfulResource("/guarded-records", new GuardedResource(), { name: "guardedRecords" });
    });

    const result = await harness.inject({ method: "GET", url: "/guarded-records/1" });

    expect(result.statusCode).toBe(403);
    expect(harness.json(result)).toEqual({ error: "no peeking" });
  });
});
