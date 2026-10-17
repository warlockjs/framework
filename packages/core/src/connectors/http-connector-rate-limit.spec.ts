import config from "@mongez/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Application } from "../application";
import { resetRolesCacheForTests } from "../application/roles";
import { getHttpServer } from "../http/server";
import { router } from "../router/router";
import { HttpConnector } from "./http-connector";

vi.mock("@warlock.js/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@warlock.js/logger")>()),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    flush: vi.fn(),
  },
}));

const roots: string[] = [];
const originalRole = process.env.WARLOCK_ROLES;
const originalStrategy = Application.runtimeStrategy;
const routerState = router as unknown as { routes: unknown[]; staticDirectories: unknown[] };
const originalRoutes = routerState.routes;
const originalDirectories = routerState.staticDirectories;

afterEach(async () => {
  await getHttpServer()?.close();
  config.set("http", undefined);
  config.set("storage.publicRoot", undefined);
  config.set("storage.publicPrefix", undefined);
  config.set("app.baseUrl", undefined);
  routerState.routes = originalRoutes;
  routerState.staticDirectories = originalDirectories;
  Application.setRuntimeStrategy(originalStrategy);
  if (originalRole === undefined) delete process.env.WARLOCK_ROLES;
  else process.env.WARLOCK_ROLES = originalRole;
  resetRolesCacheForTests();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const staticUrls = [
  "/public/asset.txt",
  "/assets/asset.txt",
  "/exact/asset.txt",
  "/file.txt",
  "/cached-file.txt",
];

async function bootWithStaticFiles(
  strategy: "production" | "development",
  rateLimit: Record<string, unknown> = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "warlock-rate-limit-"));
  roots.push(root);
  writeFileSync(path.join(root, "asset.txt"), "asset");
  process.env.WARLOCK_ROLES = "api";
  resetRolesCacheForTests();
  Application.setRuntimeStrategy(strategy);
  config.set("http", {
    port: 0,
    host: "127.0.0.1",
    rateLimit: { max: 2, timeWindow: 60_000, ...rateLimit },
  });
  config.set("app.baseUrl", "http://127.0.0.1");
  config.set("storage.publicRoot", root);
  config.set("storage.publicPrefix", "/public/");
  routerState.routes = [];
  routerState.staticDirectories = [];
  router.get("/application", ({ response }) => response.send("application"));
  router.directory({ root, prefix: "/assets/" });
  router.directory({ root, prefix: "/exact/", wildcard: false });
  router.file("/file.txt", path.join(root, "asset.txt"));
  router.cachedFile("/cached-file.txt", path.join(root, "asset.txt"));

  const connector = new HttpConnector();
  await connector.boot();
  await connector.start();

  return { root, baseUrl: boundUrl() };
}

async function exhaustApplicationQuota(baseUrl: string) {
  const statuses: number[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(baseUrl + "/application");
    statuses.push(response.status);
    expect(response.headers.get("x-ratelimit-limit")).toBe("2");
    await response.text();
  }

  expect(statuses).toEqual([200, 200, 429]);
}

describe("HTTP connector global rate limiting", () => {
  it.each(["production", "development"] as const)(
    "exempts static files from the global limiter by default in %s",
    async (strategy) => {
      const { baseUrl } = await bootWithStaticFiles(strategy);
      const server = getHttpServer();
      expect(server.hasReplyDecorator("sendFile")).toBe(true);
      expect(server.hasReplyDecorator("download")).toBe(true);

      await exhaustApplicationQuota(baseUrl);

      for (const url of staticUrls) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(baseUrl + url);
          expect(response.status, url).toBe(200);
          expect(response.headers.get("x-ratelimit-limit"), url).toBeNull();
          expect(response.headers.get("x-ratelimit-remaining"), url).toBeNull();
          expect(await response.text()).toBe("asset");
        }
      }

      for (const url of ["/health", "/ready"]) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(baseUrl + url);
          expect(response.status).toBe(url === "/health" ? 200 : 503);
          expect(response.headers.get("x-ratelimit-limit")).toBeNull();
          await response.text();
        }
      }

      // Static traffic left the application's quota exactly where it was.
      const page = await fetch(baseUrl + "/application");
      expect(page.status).toBe(429);
      await page.text();
    },
  );

  it.each(["production", "development"] as const)(
    "counts static files against the shared quota with staticFiles: true in %s",
    async (strategy) => {
      const { baseUrl } = await bootWithStaticFiles(strategy, {
        staticFiles: true,
        // Independent buckets let each route exercise the same global hook.
        keyGenerator: (request: { ip: string; url: string }) => `${request.ip}:${request.url}`,
      });

      for (const url of ["/application", ...staticUrls]) {
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(baseUrl + url);
          statuses.push(response.status);
          expect(response.headers.get("x-ratelimit-limit"), url).toBe("2");
          expect(response.headers.get("x-ratelimit-remaining"), url).toBe(
            attempt === 0 ? "1" : "0",
          );
          if (attempt >= 2) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
          await response.text();
        }
        expect(statuses, url).toEqual([200, 200, 429, 429]);
      }
    },
  );

  it.each(["production", "development"] as const)(
    "lets one mount opt in while the others stay exempt in %s",
    async (strategy) => {
      const root = mkdtempSync(path.join(tmpdir(), "warlock-rate-limit-"));
      roots.push(root);
      writeFileSync(path.join(root, "asset.txt"), "asset");
      const connector = await bootConnector(strategy);
      router.get("/application", ({ response }) => response.send("application"));
      router.directory({ root, prefix: "/counted/" }, { rateLimit: true });
      router.directory({ root, prefix: "/own/" }, { rateLimit: { max: 1, timeWindow: 60_000 } });
      router.directory({ root, prefix: "/free/" });
      router.file("/counted-file.txt", path.join(root, "asset.txt"), undefined, {
        rateLimit: true,
      });
      await connector.start();
      const baseUrl = boundUrl();

      const counted = await fetch(baseUrl + "/counted/asset.txt");
      expect(counted.headers.get("x-ratelimit-remaining")).toBe("1");
      await counted.text();
      const countedFile = await fetch(baseUrl + "/counted-file.txt");
      expect(countedFile.headers.get("x-ratelimit-remaining")).toBe("0");
      await countedFile.text();
      const application = await fetch(baseUrl + "/application");
      expect(application.status).toBe(429);
      await application.text();

      for (const status of [200, 429]) {
        const own = await fetch(baseUrl + "/own/asset.txt");
        expect(own.status).toBe(status);
        expect(own.headers.get("x-ratelimit-limit")).toBe("1");
        await own.text();
      }

      const free = await fetch(baseUrl + "/free/asset.txt");
      expect(free.status).toBe(200);
      expect(free.headers.get("x-ratelimit-limit")).toBeNull();
      await free.text();
    },
  );
});

async function bootConnector(
  strategy: "production" | "development",
  options: Record<string, unknown> = {},
) {
  process.env.WARLOCK_ROLES = "api";
  resetRolesCacheForTests();
  Application.setRuntimeStrategy(strategy);
  config.set("http", {
    port: 0,
    host: "127.0.0.1",
    rateLimit: { max: 2, timeWindow: 60_000 },
    ...options,
  });
  config.set("app.baseUrl", "http://127.0.0.1");
  config.set("storage.publicRoot", false);
  routerState.routes = [];
  routerState.staticDirectories = [];
  const connector = new HttpConnector();
  await connector.boot();
  return connector;
}

function boundUrl(): string {
  const address = getHttpServer().server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

for (const strategy of ["production", "development"] as const) {
  it(`keeps probes outside the shared page/API client quota in ${strategy}`, async () => {
    const connector = await bootConnector(strategy);
    router.get("/api", ({ response }) => response.send("api"));
    // Web pages register directly on the shared Fastify server too.
    getHttpServer().get("/page", (_request: FastifyRequest, reply: FastifyReply) =>
      reply.type("text/html").send("<p>Page</p>"),
    );
    await connector.start();
    const baseUrl = boundUrl();
    const page = await fetch(baseUrl + "/page");
    expect(page.status).toBe(200);
    expect(page.headers.get("x-ratelimit-remaining")).toBe("1");
    await page.text();
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const url of ["/health", "/ready"]) {
        const probe = await fetch(baseUrl + url);
        expect(probe.status).toBe(url === "/health" ? 200 : 503);
        expect(probe.headers.get("x-ratelimit-limit")).toBeNull();
        await probe.text();
      }
    }
    const api = await fetch(baseUrl + "/api");
    expect(api.status).toBe(200);
    expect(api.headers.get("x-ratelimit-remaining")).toBe("0");
    await api.text();
    const exhausted = await fetch(baseUrl + "/page");
    expect(exhausted.status).toBe(429);
    await exhausted.text();
    for (const url of ["/health", "/ready"]) {
      const probe = await fetch(baseUrl + url);
      expect(probe.status).toBe(url === "/health" ? 200 : 503);
      await probe.text();
    }
  });

  it(`lets renamed health probes opt back into the global quota in ${strategy}`, async () => {
    const connector = await bootConnector(strategy, {
      health: { path: "/live", readinessPath: "/readiness", rateLimit: true },
    });
    router.get("/api", ({ response }) => response.send("api"));
    await connector.start();
    const baseUrl = boundUrl();
    const liveness = await fetch(baseUrl + "/live");
    expect(liveness.status).toBe(200);
    expect(liveness.headers.get("x-ratelimit-remaining")).toBe("1");
    await liveness.text();
    const readiness = await fetch(baseUrl + "/readiness");
    expect(readiness.status).toBe(503);
    expect(readiness.headers.get("x-ratelimit-remaining")).toBe("0");
    await readiness.text();
    for (const url of ["/live", "/readiness", "/api"]) {
      const response = await fetch(baseUrl + url);
      expect(response.status).toBe(429);
      await response.text();
    }
  });

  it(`global:false keeps blanket quotas off and explicit route limits on in ${strategy}`, async () => {
    const connector = await bootConnector(strategy, {
      rateLimit: { global: false, max: 1, timeWindow: 60_000 },
      health: { rateLimit: true },
    });
    router.get("/limited", ({ response }) => response.send("limited"), {
      rateLimit: { max: 1, timeWindow: 60_000 },
    });
    router.get("/unlimited", ({ response }) => response.send("unlimited"));
    getHttpServer().get("/page", async () => "page");
    await connector.start();
    const baseUrl = boundUrl();
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const url of ["/unlimited", "/page", "/health"]) {
        const response = await fetch(baseUrl + url);
        expect(response.status).toBe(200);
        expect(response.headers.get("x-ratelimit-limit")).toBeNull();
        await response.text();
      }
    }
    for (const status of [200, 429]) {
      const response = await fetch(baseUrl + "/limited");
      expect(response.status).toBe(status);
      await response.text();
    }
  });
  it(`exempts opted-out routes the same way in ${strategy}`, async () => {
    const connector = await bootConnector(strategy);
    router.get("/api", ({ response }) => response.send("api"));
    router.get("/exempt", ({ response }) => response.send("exempt"), { rateLimit: false });
    router.get("/passed-through", ({ response }) => response.send("passed"), {
      serverOptions: { config: { rateLimit: false } },
    });
    router.get("/exempt-files/*", ({ response }) => response.send("exempt wildcard"), {
      rateLimit: false,
    });
    router.get("/files/*", ({ response }) => response.send("wildcard"));
    await connector.start();
    const baseUrl = boundUrl();

    for (let attempt = 0; attempt < 4; attempt++) {
      for (const url of ["/exempt", "/passed-through", "/exempt-files/a/b.txt", "/missing"]) {
        const response = await fetch(baseUrl + url);
        expect(response.status, url).toBe(url === "/missing" ? 404 : 200);
        expect(response.headers.get("x-ratelimit-limit"), url).toBeNull();
        await response.text();
      }
    }

    // A wildcard route that does not opt out shares the application bucket.
    const wildcard = await fetch(baseUrl + "/files/a/b.txt");
    expect(wildcard.status).toBe(200);
    expect(wildcard.headers.get("x-ratelimit-remaining")).toBe("1");
    await wildcard.text();
    const api = await fetch(baseUrl + "/api");
    expect(api.headers.get("x-ratelimit-remaining")).toBe("0");
    await api.text();
    const exhausted = await fetch(baseUrl + "/files/c.txt");
    expect(exhausted.status).toBe(429);
    await exhausted.text();
  });
}
