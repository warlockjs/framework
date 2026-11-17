import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("../src/ui-root", () => ({ resolveUiRoot: () => state.root }));

import { registerUiAssets } from "../src/server/ui-assets";

async function build() {
  const server = Fastify();

  registerUiAssets(server);
  await server.ready();

  return server;
}

describe("registerUiAssets", () => {
  beforeEach(() => {
    state.root = mkdtempSync(path.join(tmpdir(), "devtools-ui-"));
  });

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true });
  });

  it("answers 503 with a build hint while the dashboard is not built", async () => {
    const server = await build();
    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("The devtools dashboard has not been built.");
    expect(response.body).toContain("pnpm --filter @warlock.js/devtools build:ui");
  });

  it("serves the built index as is, with no tab injection", async () => {
    mkdirSync(path.join(state.root, "dashboard", "assets"), { recursive: true });
    writeFileSync(path.join(state.root, "dashboard", "index.html"), "<title>Warlock Devtools</title><div id=root></div>");
    writeFileSync(path.join(state.root, "dashboard", "assets", "app.js"), "console.log(1)");
    writeFileSync(path.join(state.root, "dashboard", "assets", "app.css"), "body{}");

    const server = await build();
    const index = await server.inject({ method: "GET", url: "/" });
    const js = await server.inject({ method: "GET", url: "/assets/app.js" });
    const css = await server.inject({ method: "GET", url: "/assets/app.css" });

    expect(index.statusCode).toBe(200);
    expect(index.body).toBe("<title>Warlock Devtools</title><div id=root></div>");
    expect(index.headers["cache-control"]).toBe("no-store");
    expect(js.body).toBe("console.log(1)");
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  it("answers 404 for names outside the whitelist and for traversal attempts", async () => {
    mkdirSync(path.join(state.root, "dashboard", "assets"), { recursive: true });
    writeFileSync(path.join(state.root, "dashboard", "assets", "secret.txt"), "secret");
    writeFileSync(path.join(state.root, "package.json"), "{}");

    const server = await build();

    for (const url of [
      "/assets/secret.txt",
      "/assets/..%2Fpackage.json",
      "/assets/%2e%2e%2fpackage.json",
      "/assets/__proto__",
      "/assets/constructor",
    ]) {
      const response = await server.inject({ method: "GET", url });

      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain("secret");
    }
  });

  it("answers 404 for a whitelisted asset that was not built", async () => {
    const server = await build();
    const response = await server.inject({ method: "GET", url: "/assets/app.js" });

    expect(response.statusCode).toBe(404);
  });
});
