import config from "@mongez/config";
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

describe("HTTP connector global rate limiting", () => {
  it.each(["production", "development"] as const)(
    "installs the limiter before application and static routes in %s",
    async (strategy) => {
      const root = mkdtempSync(path.join(tmpdir(), "warlock-rate-limit-"));
      roots.push(root);
      writeFileSync(path.join(root, "asset.txt"), "asset");
      process.env.WARLOCK_ROLES = "api";
      resetRolesCacheForTests();
      Application.setRuntimeStrategy(strategy);
      config.set("http", {
        port: 0,
        host: "127.0.0.1",
        rateLimit: {
          max: 2,
          timeWindow: 60_000,
          // Independent buckets let each route exercise the same global hook.
          keyGenerator: (request: { ip: string; url: string }) => `${request.ip}:${request.url}`,
        },
      });
      config.set("app.baseUrl", "http://127.0.0.1");
      config.set("storage.publicRoot", root);
      config.set("storage.publicPrefix", "/public/");
      routerState.routes = [];
      routerState.staticDirectories = [];
      router.get("/application", ({ response }) => response.send("application"));
      router.directory({ root, prefix: "/assets/" });
      router.directory({ root, prefix: "/exact/", wildcard: false });

      const connector = new HttpConnector();
      await connector.boot();
      await connector.start();
      const server = getHttpServer();
      const address = server.server.address();
      expect(address).toEqual(expect.objectContaining({ port: expect.any(Number) }));
      const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
      expect(server.hasReplyDecorator("sendFile")).toBe(true);
      expect(server.hasReplyDecorator("download")).toBe(true);
      for (const url of [
        "/application",
        "/public/asset.txt",
        "/assets/asset.txt",
        "/exact/asset.txt",
        "/health",
      ]) {
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(baseUrl + url);
          statuses.push(response.status);
          expect(response.headers.get("x-ratelimit-limit")).toBe("2");
          expect(response.headers.get("x-ratelimit-remaining")).toBe(attempt === 0 ? "1" : "0");
          if (attempt >= 2) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
          await response.text();
        }
        expect(statuses, url).toEqual([200, 200, 429, 429]);
      }
    },
  );
});
