import { Readable } from "node:stream";
import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorResponseFormatter, type HttpErrorResponseFormatter } from "./error-response";
import { startHttpServer, type FastifyInstance } from "./server";

const servers: FastifyInstance[] = [];

function serverWith(formatter?: HttpErrorResponseFormatter) {
  vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
    key === "http.errorResponse" ? formatter : fallback) as typeof config.get);
  const server = startHttpServer();
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

describe("http.errorResponse", () => {
  it("formats unmatched routes and correlates the body with the response header", async () => {
    const server = serverWith(({ status, requestId }) => ({
      error: { code: `http${status}`, message: "Request failed." },
      requestId,
    }));

    const response = await server.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "http404", message: "Request failed." },
      requestId: response.headers["x-request-id"],
    });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("receives serialized validation, rate-limit and server-error bodies and the Warlock ID", async () => {
    const formatter = vi.fn<HttpErrorResponseFormatter>(({ status, body, requestId }) => ({
      error: { code: `http${status}`, message: "Request failed." },
      details: body,
      requestId,
    }));
    const server = serverWith(formatter);
    for (const status of [422, 429, 500]) {
      server.get(`/error-${status}`, (_request: FastifyRequest, reply: FastifyReply) =>
        reply.header("X-Request-Id", "warlock-request-id").code(status).send({ errors: [] }),
      );
    }

    for (const status of [422, 429, 500]) {
      const response = await server.inject({ method: "GET", url: `/error-${status}` });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({
        error: { code: `http${status}`, message: "Request failed." },
        details: { errors: [] },
        requestId: "warlock-request-id",
      });
    }
  });

  it("formats Fastify parsing failures before a Warlock Request exists", async () => {
    const server = serverWith(({ status, requestId }) => ({
      error: { code: `http${status}` },
      requestId,
    }));
    server.post("/parse", async () => ({ ok: true }));

    const response = await server.inject({
      method: "POST",
      url: "/parse",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "http400" },
      requestId: response.headers["x-request-id"],
    });
  });

  it("formats global rate-limit responses before the route handler", async () => {
    const server = serverWith(({ status, requestId }) => ({
      error: { code: `http${status}` },
      requestId,
    }));
    server.register(import("@fastify/rate-limit"), { max: 1, timeWindow: 60_000 });
    await server.after();
    server.get("/limited", async () => ({ ok: true }));

    await server.inject("/limited");
    const response = await server.inject("/limited");

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: "http429" },
      requestId: response.headers["x-request-id"],
    });
    expect(response.headers["retry-after"]).toBeDefined();
  });

  it("preserves default responses when unconfigured or when the formatter declines", async () => {
    for (const formatter of [undefined, () => undefined]) {
      const server = serverWith(formatter);
      server.get("/error", (_request: FastifyRequest, reply: FastifyReply) =>
        reply.code(409).send({ error: "Conflict" }),
      );

      const response = await server.inject({ method: "GET", url: "/error" });

      expect(response.json()).toEqual({ error: "Conflict" });
    }
  });

  it("leaves success, HTML errors and streams alone", async () => {
    const formatter = vi.fn<HttpErrorResponseFormatter>(() => ({ changed: true }));
    const server = serverWith(formatter);
    server.get("/success", async () => ({ ok: true }));
    server.get("/html", (_request: FastifyRequest, reply: FastifyReply) =>
      reply.code(404).type("text/html").send("<h1>Missing</h1>"),
    );
    server.get("/text", (_request: FastifyRequest, reply: FastifyReply) =>
      reply.code(400).type("text/plain").send("Invalid"),
    );
    server.get("/stream", (_request: FastifyRequest, reply: FastifyReply) =>
      reply
        .code(500)
        .type("application/json")
        .send(Readable.from(['{"error":"stream"}'])),
    );

    expect((await server.inject("/success")).json()).toEqual({ ok: true });
    expect((await server.inject("/html")).body).toBe("<h1>Missing</h1>");
    expect((await server.inject("/text")).body).toBe("Invalid");
    expect((await server.inject("/stream")).body).toBe('{"error":"stream"}');
    expect(formatter).not.toHaveBeenCalled();
  });

  it("never formats a web data reply (x-warlock-data) and still formats the same error without it", async () => {
    const formatter = vi.fn<HttpErrorResponseFormatter>(({ status, requestId }) => ({
      error: { code: `http${status}`, message: "Request failed." },
      requestId,
    }));
    const server = serverWith(formatter);
    // The shape a failed page action answers a JS submit with: a devalue
    // string sent as application/json.
    const actionReply = '[{"actionData":1},{"ok":2,"formErrors":3},false,[4],"workspaceNotFound"]';
    server.post("/action", (_request: FastifyRequest, reply: FastifyReply) =>
      reply.code(422).type("application/json").send(actionReply),
    );
    server.get("/data-404", (_request: FastifyRequest, reply: FastifyReply) =>
      reply
        .code(404)
        .type("application/json")
        .send(JSON.stringify({ error: "not_found" })),
    );

    for (const value of ["1", "yes"]) {
      const action = await server.inject({
        method: "POST",
        url: "/action",
        headers: { "x-warlock-data": value },
      });

      expect(action.statusCode).toBe(422);
      expect(action.body).toBe(actionReply);
      expect(action.headers["content-type"]).toMatch(/^application\/json/);
    }

    const notFound = await server.inject({
      method: "GET",
      url: "/data-404",
      headers: { "x-warlock-data": "1" },
    });

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: "not_found" });
    expect(formatter).not.toHaveBeenCalled();

    // The same reply to a request without the header (an API caller) is formatted.
    const api = await server.inject({ method: "POST", url: "/action" });

    expect(api.statusCode).toBe(422);
    expect(api.json()).toEqual({
      error: { code: "http422", message: "Request failed." },
      requestId: api.headers["x-request-id"],
    });

    // An empty header value is not a data request.
    const empty = await server.inject({
      method: "GET",
      url: "/data-404",
      headers: { "x-warlock-data": "" },
    });

    expect(empty.json()).toEqual({
      error: { code: "http404", message: "Request failed." },
      requestId: empty.headers["x-request-id"],
    });
    expect(formatter).toHaveBeenCalledTimes(2);
  });

  it("logs formatter failures and retains the original error body", async () => {
    const failure = new Error("formatter failed");
    const logger = vi.spyOn(log, "error").mockResolvedValue(undefined as never);
    const server = serverWith(() => {
      throw failure;
    });
    server.get("/error", (_request: FastifyRequest, reply: FastifyReply) =>
      reply.code(409).send({ error: "Conflict" }),
    );

    const response = await server.inject("/error");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Conflict" });
    expect(logger).toHaveBeenCalledWith("http", "error-response", failure, {
      requestId: expect.any(String),
    });
  });

  it("returns the payload untouched when the reply was already written", async () => {
    const formatter = vi.fn<HttpErrorResponseFormatter>(() => ({ formatted: true }));
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorResponse" ? formatter : fallback) as typeof config.get);
    let hook: (request: unknown, reply: unknown, payload: unknown) => Promise<unknown>;
    registerErrorResponseFormatter({
      addHook: (_name: string, callback: typeof hook) => {
        hook = callback;
      },
    } as never);
    const payload = JSON.stringify({ statusCode: 403 });
    const replyFor = (raw: Record<string, boolean>, sent = false) => ({
      sent,
      raw,
      statusCode: 403,
      getHeader: () => "application/json",
      header: vi.fn(),
      removeHeader: vi.fn(),
    });

    for (const reply of [
      replyFor({}, true),
      replyFor({ headersSent: true }),
      replyFor({ writableEnded: true }),
    ]) {
      expect(await hook!({ id: "1" }, reply, payload)).toBe(payload);
      expect(reply.header).not.toHaveBeenCalled();
    }

    expect(formatter).not.toHaveBeenCalled();
  });
});
