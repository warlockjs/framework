/**
 * The production client bundle (`/assets/*`) and the build's public files are
 * static files: a page load fetches many of them, so they stay outside the
 * global HTTP rate limiter unless `http.rateLimit.staticFiles` opts them in.
 * Exercised through core's real `HttpConnector` boot with the exact mounts the
 * web connector registers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Application,
  HttpConnector,
  setConfig,
  getHttpServer,
  resetRolesCacheForTests,
  router,
} from "@warlock.js/core";
import { registerProductionPublicFiles } from "./register-production-public-files";
import { productionAssetsDirectoryOptions } from "./web-connector";

const routerState = router as unknown as { routes: unknown[]; staticDirectories: unknown[] };
const originalRoutes = routerState.routes;
const originalDirectories = routerState.staticDirectories;
const originalRoles = process.env.WARLOCK_ROLES;
const originalStrategy = Application.runtimeStrategy;
const clientDirs: string[] = [];

afterEach(async () => {
  await getHttpServer()?.close();
  setConfig("http", undefined);
  setConfig("storage.publicRoot", undefined);
  setConfig("app.baseUrl", undefined);
  routerState.routes = originalRoutes;
  routerState.staticDirectories = originalDirectories;
  Application.setRuntimeStrategy(originalStrategy);
  if (originalRoles === undefined) delete process.env.WARLOCK_ROLES;
  else process.env.WARLOCK_ROLES = originalRoles;
  resetRolesCacheForTests();
  for (const clientDir of clientDirs.splice(0)) {
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});

function clientBuild(): string {
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-web-assets-"));
  clientDirs.push(clientDir);
  fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(clientDir, "public"), { recursive: true });
  fs.writeFileSync(path.join(clientDir, "assets", "hydration-abc123.js"), "export {};");
  fs.writeFileSync(path.join(clientDir, "assets", "index-abc123.css"), "body{}");
  fs.writeFileSync(path.join(clientDir, "public", "favicon.svg"), "<svg />");

  return clientDir;
}

async function boot(strategy: "production" | "development", rateLimit: Record<string, unknown>) {
  const clientDir = clientBuild();
  process.env.WARLOCK_ROLES = "web";
  resetRolesCacheForTests();
  Application.setRuntimeStrategy(strategy);
  setConfig("http", { port: 0, host: "127.0.0.1", rateLimit: { max: 2, ...rateLimit } });
  setConfig("app.baseUrl", "http://127.0.0.1");
  setConfig("storage.publicRoot", false);
  routerState.routes = [];
  routerState.staticDirectories = [];
  router.get("/page", ({ response }) => response.send("page"));
  router.directory(productionAssetsDirectoryOptions(clientDir));
  registerProductionPublicFiles(router, clientDir, ["favicon.svg"], () => undefined);

  const connector = new HttpConnector();
  await connector.boot();
  await connector.start();
  const address = getHttpServer().server.address() as { port: number };

  return `http://127.0.0.1:${address.port}`;
}

const assetUrls = ["/assets/hydration-abc123.js", "/assets/index-abc123.css", "/favicon.svg"];

describe.each(["production", "development"] as const)("web static assets in %s", (strategy) => {
  it("stay reachable after the page quota is spent", async () => {
    const baseUrl = await boot(strategy, {});

    for (const status of [200, 200, 429]) {
      const page = await fetch(baseUrl + "/page");
      expect(page.status).toBe(status);
      await page.text();
    }

    for (const url of assetUrls) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(baseUrl + url);
        expect(response.status, url).toBe(200);
        expect(response.headers.get("x-ratelimit-limit"), url).toBeNull();
        await response.text();
      }
    }
  });

  it("count against the shared quota with staticFiles: true", async () => {
    const baseUrl = await boot(strategy, { staticFiles: true });

    const first = await fetch(baseUrl + assetUrls[0]);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-remaining")).toBe("1");
    await first.text();

    const second = await fetch(baseUrl + "/favicon.svg");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-ratelimit-remaining")).toBe("0");
    await second.text();

    for (const url of ["/page", assetUrls[1]]) {
      const response = await fetch(baseUrl + url);
      expect(response.status, url).toBe(429);
      await response.text();
    }
  });
});
