import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * End-to-end routing: a request injected into a live Fastify instance must
 * dispatch to the right controller, with params/query/body parsed through the
 * real `Request`, and unknown routes / methods handled by Fastify's matcher.
 *
 * These exercise the production path `router.scan()` wires — the same handler
 * Fastify calls in a real server — not the in-memory route registry.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("HTTP routing — dispatch", () => {
  it("routes a GET to the matching controller and returns its body", async () => {
    harness = await bootHarness((router) => {
      router.get("/ping", (_request, response) => {
        return response.success({ pong: true });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/ping" });

    expect(result.statusCode).toBe(200);
    expect(harness.json(result)).toEqual({ pong: true });
  });

  it("routes a POST to a different controller than the GET on the same path", async () => {
    harness = await bootHarness((router) => {
      router.get("/articles", (_request, response) => {
        return response.success({ action: "list" });
      });

      router.post("/articles", (_request, response) => {
        return response.successCreate({ action: "create" });
      });
    });

    const list = await harness.inject({ method: "GET", url: "/articles" });
    const create = await harness.inject({ method: "POST", url: "/articles", payload: {} });

    expect(list.statusCode).toBe(200);
    expect(harness.json(list)).toEqual({ action: "list" });

    expect(create.statusCode).toBe(201);
    expect(harness.json(create)).toEqual({ action: "create" });
  });

  it("parses a path param into request.input()", async () => {
    harness = await bootHarness((router) => {
      router.get("/users/:id", (request, response) => {
        return response.success({ id: request.input("id") });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/users/42" });

    expect(harness.json(result)).toEqual({ id: "42" });
  });

  it("parses query-string values into request.query and request.input()", async () => {
    harness = await bootHarness((router) => {
      router.get("/search", (request, response) => {
        return response.success({
          term: request.input("term"),
          page: request.input("page"),
          query: request.query,
        });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/search?term=books&page=2" });

    expect(harness.json(result)).toEqual({
      term: "books",
      page: "2",
      query: { term: "books", page: "2" },
    });
  });

  it("parses a JSON body into request.body", async () => {
    harness = await bootHarness((router) => {
      router.post("/echo", (request, response) => {
        return response.success({ body: request.body });
      });
    });

    const result = await harness.inject({
      method: "POST",
      url: "/echo",
      payload: { title: "Hello", count: 3 },
    });

    expect(harness.json(result)).toEqual({ body: { title: "Hello", count: 3 } });
  });

  it("merges param + query + body into request.all()", async () => {
    harness = await bootHarness((router) => {
      router.post("/merge/:id", (request, response) => {
        return response.success(request.all());
      });
    });

    const result = await harness.inject({
      method: "POST",
      url: "/merge/7?from=query",
      payload: { from: "body", extra: "value" },
    });

    // params win over query which wins over body in the spread order.
    expect(harness.json(result)).toEqual({
      id: "7",
      from: "query",
      extra: "value",
    });
  });
});

describe("HTTP routing — misses", () => {
  it("returns 404 for an unregistered path", async () => {
    harness = await bootHarness((router) => {
      router.get("/known", (_request, response) => response.success());
    });

    const result = await harness.inject({ method: "GET", url: "/unknown" });

    expect(result.statusCode).toBe(404);
  });

  it("returns 404 when the path matches but the method does not", async () => {
    harness = await bootHarness((router) => {
      router.get("/only-get", (_request, response) => response.success());
    });

    const result = await harness.inject({ method: "DELETE", url: "/only-get" });

    expect(result.statusCode).toBe(404);
  });

  it("does not merge a trailing slash onto a registered route", async () => {
    harness = await bootHarness((router) => {
      router.get("/strict", (_request, response) => response.success({ ok: true }));
    });

    const exact = await harness.inject({ method: "GET", url: "/strict" });
    const trailing = await harness.inject({ method: "GET", url: "/strict/" });

    expect(exact.statusCode).toBe(200);
    expect(trailing.statusCode).toBe(404);
  });
});

describe("HTTP routing — request correlation", () => {
  it("stamps the X-Request-Id response header", async () => {
    harness = await bootHarness((router) => {
      router.get("/correlated", (_request, response) => response.success());
    });

    const result = await harness.inject({ method: "GET", url: "/correlated" });

    expect(result.headers["x-request-id"]).toBeTruthy();
  });

  it("inherits a client-supplied X-Request-Id", async () => {
    harness = await bootHarness((router) => {
      router.get("/inherit-id", (request, response) => response.success({ id: request.id }));
    });

    const result = await harness.inject({
      method: "GET",
      url: "/inherit-id",
      headers: { "x-request-id": "client-correlation-1" },
    });

    expect(result.headers["x-request-id"]).toBe("client-correlation-1");
    expect(harness.json(result)).toEqual({ id: "client-correlation-1" });
  });
});
