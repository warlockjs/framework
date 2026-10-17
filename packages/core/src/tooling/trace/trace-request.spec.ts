import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeDevServerState } from "../dev-state/dev-server-state";
import type { DevtoolsRequestRecord } from "../devtools/devtools-client";
import { buildTraceReport, readResponseBody, resolveTraceUrl, traceRequest } from "./trace-request";

/**
 * `traceRequest()` end-to-end against a real HTTP server on an ephemeral
 * port that plays both the app (echoing `x-request-id`) and the devtools API
 * (`/__warlock/api/requests[/:id]`). The record is in flight on the first
 * poll and settled on the next, like the real collector between the response
 * and `onRequestEnd`.
 */

type FakeOptions = {
  devtools?: boolean;
  recordRequests?: boolean;
};

type FakeServer = {
  url: string;
  received: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[];
  close(): Promise<void>;
};

function settledRecord(
  id: string,
  requestPath: string,
  validationFailed: boolean,
): DevtoolsRequestRecord {
  const phases = [
    { name: "route.match", startedAt: 1, durationMs: 0.2, attrs: { route: "/posts" } },
    {
      name: "middleware",
      startedAt: 2,
      durationMs: 1.5,
      attrs: { name: "authMiddleware", index: 0 },
    },
    { name: "validation", startedAt: 4, durationMs: 0.7 },
  ];

  if (!validationFailed) phases.push({ name: "handler", startedAt: 5, durationMs: 9 });

  return {
    id,
    method: "POST",
    path: requestPath,
    route: "/posts",
    status: validationFailed ? 422 : 201,
    startedAt: 1,
    durationMs: 12.5,
    phases,
    queries: [
      {
        id: "q1",
        sql: "select * from users where id = ?",
        shape: "select * from users where id = ?",
        durationMs: 1,
      },
      { id: "q2", sql: "insert into posts", shape: "insert into posts", durationMs: 2 },
    ],
    cache: [{ type: "miss", driver: "memory", key: "posts", at: 3 }],
    logs: [{ level: "info", module: "posts", action: "create", message: "created", at: 6 }],
    mails: ["m1"],
    warnings: [
      { type: "n+1", message: "N+1 query", shape: "select * from users where id = ?", count: 6 },
    ],
  };
}

async function startFake(options: FakeOptions = {}): Promise<FakeServer> {
  const records = new Map<string, { record: DevtoolsRequestRecord; polls: number }>();
  const received: FakeServer["received"] = [];

  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = request.url ?? "/";
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(JSON.stringify(body));
      };

      if (url.startsWith("/__warlock/api/requests")) {
        if (options.devtools === false) return json(404, { error: "not found" });

        const id = decodeURIComponent(url.slice("/__warlock/api/requests/".length));

        if (url === "/__warlock/api/requests") return json(200, []);

        const entry = records.get(id);

        if (!entry) return json(404, null);

        entry.polls++;

        if (entry.polls === 1) {
          return json(200, { ...entry.record, durationMs: undefined });
        }

        return json(200, entry.record);
      }

      const body = Buffer.concat(chunks).toString("utf8");
      const id = String(
        request.headers["x-request-id"] ?? request.headers["x-correlation-id"] ?? "generated-id",
      );

      received.push({ method: request.method ?? "", url, headers: request.headers, body });

      const failed = body.includes('"title":""');

      if (options.recordRequests !== false) {
        records.set(id, { record: settledRecord(id, url, failed), polls: 0 });
      }

      if (failed) {
        return json(
          422,
          { errors: [{ input: "title", error: "The title is required" }] },
          { "x-request-id": id },
        );
      }

      return json(201, { post: { id: 1 } }, { "x-request-id": id });
    });
  };

  const server: Server = createServer(handler);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("traceRequest", () => {
  let fake: FakeServer | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "warlock-trace-"));
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  it("sends the request with an x-request-id and returns the settled devtools timeline", async () => {
    fake = await startFake();

    const report = await traceRequest({
      method: "post",
      url: "/posts?draft=1",
      body: { title: "Hello" },
      headers: { authorization: "Bearer secret" },
      serverUrl: fake.url,
      cwd: directory,
      intervalMs: 5,
    });

    const sent = fake.received[0];

    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe("/posts?draft=1");
    expect(sent?.headers["content-type"]).toBe("application/json");
    expect(sent?.body).toBe('{"title":"Hello"}');
    expect(report.requestId).toBe(sent?.headers["x-request-id"]);

    expect(report.schemaVersion).toBe(1);
    expect(report.request.headers.authorization).toBe("[redacted]");
    expect(report.response).toMatchObject({
      status: 201,
      body: { post: { id: 1 } },
      truncated: false,
    });
    expect(report.route).toBe("/posts");
    expect(report.timeline.middleware).toEqual([
      { name: "authMiddleware", index: 0, durationMs: 1.5 },
    ]);
    expect(report.timeline.validation).toEqual({
      ran: true,
      durationMs: 0.7,
      passed: true,
      errors: null,
    });
    expect(report.timeline.handler).toEqual({ durationMs: 9 });
    expect(report.timeline.routeMatch).toEqual({ durationMs: 0.2 });
    expect(report.queries.map((query) => query.nPlusOne)).toEqual([true, false]);
    expect(report.timings.totalMs).toBe(12.5);
    expect(report.timings.phasesMs).toMatchObject({ middleware: 1.5, handler: 9 });
    expect(report.timings.clientMs).toBeGreaterThanOrEqual(0);
    expect(report.mails).toEqual(["m1"]);
    expect(report.logs).toHaveLength(1);
  });

  it("reports a failed validation with the response's errors", async () => {
    fake = await startFake();

    const report = await traceRequest({
      method: "POST",
      url: "/posts",
      body: { title: "" },
      serverUrl: fake.url,
      cwd: directory,
      intervalMs: 5,
    });

    expect(report.response.status).toBe(422);
    expect(report.timeline.handler).toBeNull();
    expect(report.timeline.validation).toMatchObject({
      ran: true,
      passed: false,
      errors: [{ input: "title", error: "The title is required" }],
    });
  });

  it("keeps a request id the caller set", async () => {
    fake = await startFake();

    const report = await traceRequest({
      method: "GET",
      url: "posts",
      headers: { "X-Request-Id": "my-own-id" },
      serverUrl: fake.url,
      cwd: directory,
      intervalMs: 5,
    });

    expect(fake.received[0]?.headers["x-request-id"]).toBe("my-own-id");
    expect(report.requestId).toBe("my-own-id");
  });

  it("sends the id under the app's own request id header", async () => {
    fake = await startFake();

    const report = await traceRequest({
      method: "GET",
      url: "/posts",
      requestIdHeader: "X-Correlation-Id",
      serverUrl: fake.url,
      cwd: directory,
      intervalMs: 5,
    });

    expect(fake.received[0]?.headers["x-request-id"]).toBeUndefined();
    expect(report.requestId).toBe(fake.received[0]?.headers["x-correlation-id"]);
  });

  it("finds the dev server through .warlock/dev-server.json", async () => {
    fake = await startFake();
    writeDevServerState(
      {
        schemaVersion: 1,
        pid: process.pid,
        url: fake.url,
        startedAt: new Date(0).toISOString(),
        devtools: { path: "/__warlock" },
        mcp: null,
      },
      directory,
    );

    const report = await traceRequest({
      method: "GET",
      url: "/posts",
      cwd: directory,
      intervalMs: 5,
    });

    expect(report.server).toBe(fake.url);
  });

  it("fails with WL8008 when no dev server is recorded", async () => {
    await expect(traceRequest({ method: "GET", url: "/", cwd: directory })).rejects.toMatchObject({
      code: "WL8008",
    });
  });

  it("fails with WL8008 when nothing listens at the address", async () => {
    const closed = await startFake();
    await closed.close();

    await expect(
      traceRequest({ method: "GET", url: "/", serverUrl: closed.url, cwd: directory }),
    ).rejects.toMatchObject({ code: "WL8008" });
  });

  it("fails with WL8009 before sending when devtools is not mounted", async () => {
    fake = await startFake({ devtools: false });

    await expect(
      traceRequest({ method: "GET", url: "/posts", serverUrl: fake.url, cwd: directory }),
    ).rejects.toMatchObject({ code: "WL8009" });
    expect(fake.received).toHaveLength(0);
  });

  it("fails with WL5004 when devtools never records the request", async () => {
    fake = await startFake({ recordRequests: false });

    await expect(
      traceRequest({
        method: "GET",
        url: "/posts",
        serverUrl: fake.url,
        cwd: directory,
        timeoutMs: 30,
        intervalMs: 5,
      }),
    ).rejects.toMatchObject({ code: "WL5004" });
  });
});

describe("trace report helpers", () => {
  it("parses JSON bodies, keeps text, and cuts long bodies", () => {
    expect(readResponseBody('{"a":1}', "application/json; charset=utf-8")).toEqual({
      body: { a: 1 },
      truncated: false,
    });
    expect(readResponseBody("<p>hi</p>", "text/html")).toEqual({
      body: "<p>hi</p>",
      truncated: false,
    });
    expect(readResponseBody("", "application/json")).toEqual({ body: null, truncated: false });

    const long = readResponseBody("x".repeat(70 * 1024), "text/plain");

    expect(long.truncated).toBe(true);
    expect(String(long.body)).toHaveLength(64 * 1024);
  });

  it("joins paths to the server and keeps absolute URLs", () => {
    expect(resolveTraceUrl("http://localhost:2030", "/a?b=1")).toBe("http://localhost:2030/a?b=1");
    expect(resolveTraceUrl("http://localhost:2030", "a")).toBe("http://localhost:2030/a");
    expect(resolveTraceUrl("http://localhost:2030", "http://127.0.0.1:9/x")).toBe(
      "http://127.0.0.1:9/x",
    );
  });

  it("builds a report without validation when the route has none", () => {
    const report = buildTraceReport({
      requestId: "r1",
      server: "http://localhost:1",
      request: {
        method: "GET",
        url: "http://localhost:1/",
        headers: { cookie: "a=b" },
        body: null,
      },
      response: {
        status: 200,
        headers: { "Content-Type": "text/plain", "Set-Cookie": "x" },
        text: "ok",
      },
      record: {
        id: "r1",
        method: "GET",
        path: "/",
        startedAt: 0,
        phases: [{ name: "handler", startedAt: 0, durationMs: 1 }],
        queries: [],
        cache: [],
        logs: [],
        mails: [],
        warnings: [],
      },
      clientMs: 2,
    });

    expect(report.request.headers.cookie).toBe("[redacted]");
    expect(report.response.headers["content-type"]).toBe("text/plain");
    expect(report.timeline.validation).toEqual({
      ran: false,
      durationMs: null,
      passed: null,
      errors: null,
    });
    expect(report.timings.totalMs).toBeNull();
    expect(report.route).toBeNull();
  });
});
