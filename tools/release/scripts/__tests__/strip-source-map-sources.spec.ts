import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { assertSourceMapsSelfContained } from "../strip-source-map-sources.ts";

const roots: string[] = [];

/** A built package directory, as the release runner packs it. */
async function makeBuild(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "source-map-check-"));
  roots.push(root);
  await mkdir(path.join(root, "esm", "http"), { recursive: true });
  return root;
}

async function writeJson(file: string, value: unknown): Promise<string> {
  const content = JSON.stringify(value);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return content;
}

/** A map as the builder writes it: sources point into the framework repository. */
const repositoryMap = {
  version: 3,
  file: "server.mjs",
  names: ["start"],
  sources: ["../../../../../../../packages/core/src/http/server.ts"],
  sourcesContent: ["export function start() {}\n"],
  mappings: "AAAA",
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("assertSourceMapsSelfContained", () => {
  it("packs maps that embed their sources byte for byte, sourcesContent included", async () => {
    const root = await makeBuild();
    const mapPath = path.join(root, "esm", "http", "server.mjs.map");
    const content = await writeJson(mapPath, repositoryMap);

    assert.equal(await assertSourceMapsSelfContained(root), 1);
    assert.equal(await readFile(mapPath, "utf8"), content);
  });

  it("refuses a map whose repository sources have no embedded content", async () => {
    const root = await makeBuild();
    const { sourcesContent: _dropped, ...stripped } = repositoryMap;
    const mapPath = path.join(root, "esm", "http", "server.mjs.map");
    const content = await writeJson(mapPath, stripped);

    await assert.rejects(
      () => assertSourceMapsSelfContained(root),
      (error: Error) => {
        assert.match(
          error.message,
          /1 source map\(s\) name source files that are not in the package/,
        );
        assert.match(
          error.message,
          /esm[\\/]http[\\/]server\.mjs\.map \(\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/core\/src\/http\/server\.ts\)/,
        );
        assert.match(error.message, /Keep "sourcesContent" in the built source maps/);
        return true;
      },
    );
    assert.equal(await readFile(mapPath, "utf8"), content);
  });

  it("refuses only the sources whose sourcesContent entry is missing or null", async () => {
    const root = await makeBuild();
    await writeJson(path.join(root, "esm", "bundle.mjs.map"), {
      version: 3,
      sources: [
        "../../repo/a.ts",
        "../../repo/b.ts",
        "../../repo/c.ts",
        "",
        "https://example.test/x.ts",
        "virtual:entry",
      ],
      sourcesContent: ["a", null],
      mappings: "AAAA",
    });

    await assert.rejects(
      () => assertSourceMapsSelfContained(root),
      /esm[\\/]bundle\.mjs\.map \(\.\.\/\.\.\/repo\/b\.ts, \.\.\/\.\.\/repo\/c\.ts\)/,
    );
  });

  it("resolves sources against sourceRoot", async () => {
    const root = await makeBuild();
    await mkdir(path.join(root, "src", "http"), { recursive: true });
    await writeFile(path.join(root, "src", "http", "server.ts"), "export function start() {}\n");
    const inside = await writeJson(path.join(root, "esm", "http", "server.mjs.map"), {
      version: 3,
      sourceRoot: "../../src/",
      sources: ["http/server.ts"],
      mappings: "AAAA",
    });
    const url = await writeJson(path.join(root, "esm", "http", "client.mjs.map"), {
      version: 3,
      sourceRoot: "https://example.test/repo/",
      sources: ["packages/core/src/http/client.ts"],
      mappings: "AAAA",
    });

    assert.equal(await assertSourceMapsSelfContained(root), 2);
    assert.equal(await readFile(path.join(root, "esm", "http", "server.mjs.map"), "utf8"), inside);
    assert.equal(await readFile(path.join(root, "esm", "http", "client.mjs.map"), "utf8"), url);

    await writeJson(path.join(root, "esm", "http", "router.mjs.map"), {
      version: 3,
      sourceRoot: "../../../repo/",
      sources: ["router.ts"],
      mappings: "AAAA",
    });

    await assert.rejects(
      () => assertSourceMapsSelfContained(root),
      /esm[\\/]http[\\/]router\.mjs\.map \(router\.ts\)/,
    );
  });

  it("accepts package-relative sources that the package ships, and refuses ones it does not", async () => {
    const root = await makeBuild();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export {};\n");
    await writeJson(path.join(root, "esm", "index.mjs.map"), {
      version: 3,
      sources: ["../src/index.ts"],
      mappings: "AAAA",
    });

    assert.equal(await assertSourceMapsSelfContained(root), 1);

    await writeJson(path.join(root, "esm", "missing.mjs.map"), {
      version: 3,
      sources: ["../src/missing.ts"],
      mappings: "AAAA",
    });

    await assert.rejects(
      () => assertSourceMapsSelfContained(root),
      /esm[\\/]missing\.mjs\.map \(\.\.\/src\/missing\.ts\)/,
    );
  });

  it("leaves malformed maps, declaration maps and non-map files untouched", async () => {
    const root = await makeBuild();
    const files: Record<string, string> = {
      // JSON, but not a source map with version and mappings: a dev server ignores it.
      [path.join(root, "esm", "empty.mjs.map")]:
        '{"version":3,"sources":["../../repo/a.ts"],"mappings":""}',
      [path.join(root, "esm", "list.mjs.map")]: '["not","a","map"]',
      // Declaration maps are read by editors only and never carry sourcesContent.
      [path.join(root, "esm", "index.d.mts.map")]:
        '{"version":3,"sources":["../../repo/index.ts"],"mappings":";AAAA"}',
      [path.join(root, "esm", "index.mjs")]: "export {};\n//# sourceMappingURL=index.mjs.map\n",
    };

    for (const [file, content] of Object.entries(files)) await writeFile(file, content);

    assert.equal(await assertSourceMapsSelfContained(root), 0);

    for (const [file, content] of Object.entries(files))
      assert.equal(await readFile(file, "utf8"), content);
  });

  it("refuses a map with mappings but no sources list", async () => {
    const root = await makeBuild();
    await writeFile(path.join(root, "esm", "broken.mjs.map"), '{"version":3,"mappings":"AAAA"}');

    await assert.rejects(
      () => assertSourceMapsSelfContained(root),
      /broken\.mjs\.map \(no "sources" list\)/,
    );
  });

  it("treats a missing build directory as nothing to check", async () => {
    const root = await makeBuild();

    assert.equal(await assertSourceMapsSelfContained(path.join(root, "missing")), 0);
  });

  it("refuses a map that is not JSON instead of packing it silently", async () => {
    const root = await makeBuild();
    const mapPath = path.join(root, "esm", "broken.mjs.map");
    await writeFile(mapPath, "not json");

    await assert.rejects(() => assertSourceMapsSelfContained(root), /not valid JSON/);
    assert.equal(await readFile(mapPath, "utf8"), "not json");
  });
});
