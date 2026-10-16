/**
 * `@fastify/static` is not free to load (its directory-listing module
 * calls `os.cpus()` at import), so the HTTP stack may only reach it through
 * `import()` and only when a file request needs the sender.
 */
import config from "@mongez/config";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHttpPlugins, resolvePublicRoot } from "./plugins";

const staticModule = vi.hoisted(() => ({ loaded: 0 }));

vi.mock("@fastify/static", async () => {
  staticModule.loaded++;

  return await vi.importActual("@fastify/static");
});

/** Every external specifier reached through static `import` statements. */
async function staticExternalImports(entry: string): Promise<Set<string>> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    logLevel: "silent",
    outdir: "unused",
  });
  const inputs = result.metafile.inputs;
  const start = Object.keys(inputs).find((input) => path.resolve(input) === entry);
  const seen = new Set<string>();
  const externals = new Set<string>();
  const pending = start === undefined ? [] : [start];

  while (pending.length > 0) {
    const file = pending.pop()!;

    if (seen.has(file)) continue;
    seen.add(file);

    for (const imported of inputs[file]?.imports ?? []) {
      if (imported.kind !== "import-statement") continue;

      if (imported.external) externals.add(imported.path);
      else pending.push(imported.path);
    }
  }

  expect(seen.size).toBeGreaterThan(1);

  return externals;
}

describe("@fastify/static is loaded lazily", () => {
  const temporaryRoots: string[] = [];
  const servers: FastifyInstance[] = [];

  async function configuredServer() {
    const server = Fastify();
    servers.push(server);
    await registerHttpPlugins(server);
    server.get("/health", async () => "ok");
    await server.ready();
    return server;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    config.set("storage.publicRoot", undefined);
    config.set("storage.publicPrefix", undefined);
    staticModule.loaded = 0;

    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.each(["../router/router.ts", "./plugins.ts", "../connectors/http-connector.ts"])(
    "%s reaches @fastify/static and glob only through import()",
    async (file) => {
      const externals = await staticExternalImports(path.resolve(__dirname, file));

      expect(
        [...externals].filter(
          (specifier) => specifier.startsWith("@fastify/static") || specifier === "glob",
        ),
      ).toEqual([]);
    },
    30_000,
  );

  it("does not load @fastify/static when the public folder does not exist", async () => {
    config.set("storage.publicRoot", path.join(tmpdir(), "warlock-no-such-public-folder"));

    expect((await configuredServer()).hasRoute({ method: "GET", url: "/public/*" })).toBe(false);
    expect(staticModule.loaded).toBe(0);
  });

  it("does not load @fastify/static when publicRoot is false", async () => {
    config.set("storage.publicRoot", false);

    expect((await configuredServer()).hasRoute({ method: "GET", url: "/public/*" })).toBe(false);
    expect(staticModule.loaded).toBe(0);
  });

  it("defers an existing public folder until its first file request, sharing initialization across concurrent requests", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "warlock-public-"));
    temporaryRoots.push(root);
    writeFileSync(path.join(root, "asset.txt"), "asset");
    config.set("storage.publicRoot", root);
    const server = await configuredServer();
    expect(server.hasRoute({ method: "GET", url: "/public/*" })).toBe(true);
    expect(staticModule.loaded).toBe(0);
    expect((await server.inject({ url: "/health" })).body).toBe("ok");
    expect(staticModule.loaded).toBe(0);
    const responses = await Promise.all([
      server.inject({ url: "/public/asset.txt" }),
      server.inject({ method: "HEAD", url: "/public/asset.txt" }),
    ]);
    expect(responses[0]?.statusCode).toBe(200);
    expect(responses[0]?.body).toBe("asset");
    expect(responses[1]?.statusCode).toBe(200);
    expect(responses[1]?.body).toBe("");
    expect(staticModule.loaded).toBe(1);
    expect((await server.inject({ url: "/public/asset.txt" })).body).toBe("asset");
    expect(staticModule.loaded).toBe(1);
  });
});

describe("resolvePublicRoot", () => {
  it("passes a non-empty array through for @fastify/static to validate", () => {
    expect(resolvePublicRoot(["/a", "/b"])).toEqual(["/a", "/b"]);
  });

  it("treats an empty array, false, null and undefined as nothing to serve", () => {
    expect(resolvePublicRoot([])).toBeUndefined();
    expect(resolvePublicRoot(false)).toBeUndefined();
    expect(resolvePublicRoot(null)).toBeUndefined();
    expect(resolvePublicRoot(undefined)).toBeUndefined();
  });
});
