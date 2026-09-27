import http from "node:http";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { mountDevtoolsRoutes } from "../src/server/index";
import type { MountDevtoolsRoutesDeps } from "../src/server/types";
import type {
  DevtoolsBackground,
  DevtoolsCollector,
  DevtoolsLogEntry,
  DevtoolsMail,
  DevtoolsRequest,
  DevtoolsStreamEvent,
  ResolvedDevtoolsOptions,
} from "../src/types";

/**
 * A minimal in-memory stand-in for `createCollector`'s output, built by hand
 * rather than imported: the real collector (`src/collector.ts`) is being
 * written concurrently by another worker.
 */
type FakeCollector = DevtoolsCollector & {
  seedRequest(request: DevtoolsRequest): void;
  listenerCount(): number;
};

function createFakeCollector(): FakeCollector {
  const requests = new Map<string, DevtoolsRequest>();
  const mails = new Map<string, DevtoolsMail>();
  const logs: DevtoolsLogEntry[] = [];
  const background: DevtoolsBackground = { queries: [], cache: [], logs: [] };
  const listeners = new Set<(event: DevtoolsStreamEvent) => void>();

  return {
    startRequest(request) {
      requests.set(request.id, {
        ...request,
        phases: [],
        queries: [],
        cache: [],
        logs: [],
        mails: [],
        warnings: [],
      });
    },
    endRequest(id, result) {
      const request = requests.get(id);
      if (request) Object.assign(request, result);
    },
    addPhase(requestId, phase) {
      requests.get(requestId ?? "")?.phases.push(phase);
    },
    addQuery(requestId, query) {
      const full = {
        ...query,
        id: `q${requests.get(requestId ?? "")?.queries.length ?? 0}`,
        shape: query.sql ?? "",
      };
      requests.get(requestId ?? "")?.queries.push(full);
      return full;
    },
    addCacheOperation(requestId, operation) {
      requests.get(requestId ?? "")?.cache.push(operation);
    },
    addLog(requestId, entry) {
      if (requestId) requests.get(requestId)?.logs.push(entry);
      else logs.push(entry);
    },
    addMail(mail) {
      mails.set(mail.id, mail);
    },
    listRequests() {
      return [...requests.values()].reverse().map((request) => ({
        id: request.id,
        method: request.method,
        path: request.path,
        route: request.route,
        status: request.status,
        startedAt: request.startedAt,
        durationMs: request.durationMs,
        queryCount: request.queries.length,
        warningCount: request.warnings.length,
      }));
    },
    getRequest(id) {
      return requests.get(id);
    },
    listMails() {
      return [...mails.values()].reverse().map((mail) => ({
        id: mail.id,
        requestId: mail.requestId,
        capturedAt: mail.capturedAt,
        to: mail.to,
        subject: mail.subject,
      }));
    },
    getMail(id) {
      return mails.get(id);
    },
    listLogs() {
      return logs;
    },
    getBackground() {
      return background;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      requests.clear();
      mails.clear();
      logs.length = 0;
    },
    seedRequest(request) {
      requests.set(request.id, request);
    },
    listenerCount() {
      return listeners.size;
    },
    emit(event: DevtoolsStreamEvent) {
      for (const listener of listeners) listener(event);
    },
  } as FakeCollector & { emit(event: DevtoolsStreamEvent): void };
}

const options: ResolvedDevtoolsOptions = {
  path: "/__warlock",
  maxRequests: 200,
  nPlusOneThreshold: 5,
};

function createDeps(overrides: Partial<MountDevtoolsRoutesDeps> = {}) {
  const collector = createFakeCollector();
  let development = true;

  const deps: MountDevtoolsRoutesDeps = {
    collector,
    options,
    isDevelopment: () => development,
    ...overrides,
  };

  return {
    deps,
    collector,
    setDevelopment(value: boolean) {
      development = value;
    },
  };
}

function buildServer(deps: MountDevtoolsRoutesDeps) {
  const server = Fastify();
  server.get("/health", async () => ({ ok: true }));
  mountDevtoolsRoutes(server, deps);
  return server;
}

describe("mountDevtoolsRoutes guard", () => {
  it("returns 404 with an empty body when not in development", async () => {
    const { deps, setDevelopment } = createDeps();
    setDevelopment(false);
    const server = buildServer(deps);

    const response = await server.inject({ method: "GET", url: "/__warlock/api/requests" });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it("returns 404 for a non-loopback remote address even with a forged X-Forwarded-For header", async () => {
    const { deps } = createDeps();
    const server = buildServer(deps);

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/requests",
      remoteAddress: "10.0.0.5",
      headers: { "x-forwarded-for": "127.0.0.1" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("does not affect a route registered on the same server outside the dashboard prefix", async () => {
    const { deps } = createDeps();
    const server = buildServer(deps);

    const response = await server.inject({
      method: "GET",
      url: "/health",
      remoteAddress: "10.0.0.5",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

describe("mountDevtoolsRoutes UI assets", () => {
  it("serves index.html at the dashboard root and with a trailing slash", async () => {
    const { deps } = createDeps();
    const server = buildServer(deps);

    for (const url of ["/__warlock", "/__warlock/"]) {
      const response = await server.inject({ method: "GET", url, remoteAddress: "127.0.0.1" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toContain("<title>Warlock Devtools</title>");
    }
  });

  it("serves app.js and app.css with the right content types", async () => {
    const { deps } = createDeps();
    const server = buildServer(deps);

    const js = await server.inject({
      method: "GET",
      url: "/__warlock/assets/app.js",
      remoteAddress: "127.0.0.1",
    });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");

    const css = await server.inject({
      method: "GET",
      url: "/__warlock/assets/app.css",
      remoteAddress: "127.0.0.1",
    });
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  it("404s for any asset name outside the whitelist, blocking traversal attempts", async () => {
    const { deps } = createDeps();
    const server = buildServer(deps);

    for (const url of ["/__warlock/assets/../package.json", "/__warlock/assets/other.js"]) {
      const response = await server.inject({ method: "GET", url, remoteAddress: "127.0.0.1" });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe("mountDevtoolsRoutes mail routes", () => {
  const mail: DevtoolsMail = {
    id: "m1",
    capturedAt: 1,
    to: ["dev@example.com"],
    cc: [],
    bcc: [],
    subject: "Hi",
    html: "<p>hello</p>",
    headers: {},
    attachments: [],
  };

  it("returns the mail HTML with the sandbox CSP header", async () => {
    const { deps, collector } = createDeps();
    collector.addMail(mail);
    const server = buildServer(deps);

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/mails/m1/html",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toBe(
      "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body).toBe("<p>hello</p>");
  });

  it("404s when the mail has no stored html", async () => {
    const { deps, collector } = createDeps();
    collector.addMail({ ...mail, id: "m2", html: undefined });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/mails/m2/html",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("mountDevtoolsRoutes explain route", () => {
  function seedQueryRequest(collector: FakeCollector, query: DevtoolsRequest["queries"][number]) {
    collector.seedRequest({
      id: "r1",
      method: "GET",
      path: "/posts",
      startedAt: 1,
      phases: [],
      queries: [query],
      cache: [],
      logs: [],
      mails: [],
      warnings: [],
    });
  }

  it("400s for a Mongo query", async () => {
    const { deps, collector } = createDeps({ explain: async () => ({}) });
    seedQueryRequest(collector, {
      id: "q1",
      connection: "mongo",
      driver: "mongodb",
      collection: "posts",
      command: "find",
      startedAt: 1,
      durationMs: 1,
      shape: "posts.find",
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "POST",
      url: "/__warlock/api/requests/r1/queries/q1/explain",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(400);
  });

  it("400s for a non-SELECT/WITH statement", async () => {
    const { deps, collector } = createDeps({ explain: async () => ({}) });
    seedQueryRequest(collector, {
      id: "q1",
      connection: "pg",
      driver: "postgres",
      sql: "UPDATE users SET name = $1",
      bindings: ["a"],
      startedAt: 1,
      durationMs: 1,
      shape: "UPDATE users SET name = $1",
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "POST",
      url: "/__warlock/api/requests/r1/queries/q1/explain",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(400);
  });

  it("400s with 'bindings redacted' when a binding was censored", async () => {
    const { deps, collector } = createDeps({ explain: async () => ({}) });
    seedQueryRequest(collector, {
      id: "q1",
      connection: "pg",
      driver: "postgres",
      sql: "SELECT * FROM users WHERE token = $1",
      bindings: ["[REDACTED]"],
      startedAt: 1,
      durationMs: 1,
      shape: "SELECT * FROM users WHERE token = $1",
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "POST",
      url: "/__warlock/api/requests/r1/queries/q1/explain",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "bindings redacted" });
  });

  it("200s with the plan for a Postgres SELECT", async () => {
    const plan = { Plan: { "Node Type": "Seq Scan" } };
    const { deps, collector } = createDeps({ explain: async () => plan });
    seedQueryRequest(collector, {
      id: "q1",
      connection: "pg",
      driver: "postgres",
      sql: "SELECT * FROM users WHERE id = $1",
      bindings: [1],
      startedAt: 1,
      durationMs: 1,
      shape: "SELECT * FROM users WHERE id = $1",
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "POST",
      url: "/__warlock/api/requests/r1/queries/q1/explain",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ plan });
  });
});

describe("mountDevtoolsRoutes clear", () => {
  it("clears the collector and returns 204", async () => {
    const { deps, collector } = createDeps();
    collector.addMail({
      id: "m1",
      capturedAt: 1,
      to: [],
      cc: [],
      bcc: [],
      subject: "x",
      headers: {},
      attachments: [],
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "DELETE",
      url: "/__warlock/api/requests",
      remoteAddress: "127.0.0.1",
    });

    expect(response.statusCode).toBe(204);
    expect(collector.listMails()).toHaveLength(0);
  });

  it("never runs the handler for a refused client — a remote DELETE clears nothing", async () => {
    const { deps, collector } = createDeps();
    collector.addMail({
      id: "m1",
      capturedAt: 1,
      to: [],
      cc: [],
      bcc: [],
      subject: "x",
      headers: {},
      attachments: [],
    });
    const server = buildServer(deps);

    const response = await server.inject({
      method: "DELETE",
      url: "/__warlock/api/requests",
      remoteAddress: "10.0.0.5",
    });

    expect(response.statusCode).toBe(404);
    expect(collector.listMails()).toHaveLength(1);
  });
});

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("mountDevtoolsRoutes SSE stream", () => {
  it("streams collector events and disposes the subscriber on disconnect", async () => {
    const { deps, collector } = createDeps();
    const server = buildServer(deps);
    await server.listen({ port: 0, host: "127.0.0.1" });

    try {
      const address = server.server.address();
      if (address === null || typeof address === "string") throw new Error("expected a bound port");

      const req = http.get({
        host: "127.0.0.1",
        port: address.port,
        path: "/__warlock/api/stream",
      });

      const frame = await new Promise<string>((resolve, reject) => {
        req.on("response", (res) => {
          let received = "";
          res.on("data", (chunk) => {
            received += chunk.toString();
            if (received.includes("\n\n")) resolve(received);
          });
          res.on("error", reject);
        });
        req.on("error", reject);

        void waitUntil(() => collector.listenerCount() === 1).then(() => {
          (collector as unknown as { emit(event: DevtoolsStreamEvent): void }).emit({
            type: "log",
            data: { level: "info", module: "test", action: "x", message: "hi", at: 1 },
          });
        }, reject);
      });

      expect(frame).toBe(
        `event: log\ndata: ${JSON.stringify({ level: "info", module: "test", action: "x", message: "hi", at: 1 })}\n\n`,
      );

      req.destroy();
      await waitUntil(() => collector.listenerCount() === 0);
    } finally {
      await server.close();
    }
  });
});
