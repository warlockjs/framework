/**
 * `@fastify/static` is not free to load (its directory-listing module
 * calls `os.cpus()` at import), so the HTTP stack may only reach it through
 * `import()` and only when there is something to serve.
 */
import config from "@mongez/config";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHttpPlugins, resolvePublicRoot } from "./plugins";

const staticModule = vi.hoisted(() => ({ loaded: 0 }));

vi.mock("@fastify/static", () => {
  staticModule.loaded++;

  return { default: "static" };
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

async function registeredStaticOptions() {
  const register = vi.fn();

  await registerHttpPlugins({ register, addContentTypeParser: vi.fn() } as any);

  // `register(import("@fastify/static"), options)`: let the import settle so
  // the mock factory has run if it was going to.
  await Promise.all(register.mock.calls.map((call) => call[0]));

  return register.mock.calls.filter((call) => call[1]?.prefix !== undefined).map((call) => call[1]);
}

describe("@fastify/static is loaded lazily", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    config.set("storage.publicRoot", undefined);
    config.set("storage.publicPrefix", undefined);
    staticModule.loaded = 0;

    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.each(["../router/router.ts", "./plugins.ts", "../connectors/http-connector.ts"])(
    "%s reaches @fastify/static only through import()",
    async (file) => {
      const externals = await staticExternalImports(path.resolve(__dirname, file));

      expect([...externals].filter((specifier) => specifier.startsWith("@fastify/static"))).toEqual(
        [],
      );
    },
    30_000,
  );

  it("does not load @fastify/static when the public folder does not exist", async () => {
    config.set("storage.publicRoot", path.join(tmpdir(), "warlock-no-such-public-folder-wr027"));

    expect(await registeredStaticOptions()).toEqual([]);
    expect(staticModule.loaded).toBe(0);
  });

  it("does not load @fastify/static when publicRoot is false", async () => {
    config.set("storage.publicRoot", false);

    expect(await registeredStaticOptions()).toEqual([]);
    expect(staticModule.loaded).toBe(0);
  });

  it("serves an existing public folder exactly as before", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "warlock-public-"));
    temporaryRoots.push(root);
    config.set("storage.publicRoot", root);

    expect(await registeredStaticOptions()).toEqual([{ root, prefix: "/public/" }]);
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
