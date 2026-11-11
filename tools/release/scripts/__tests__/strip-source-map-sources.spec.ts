import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { stripSourceMapSources } from "../strip-source-map-sources.ts";

const roots: string[] = [];

async function makeBuild(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "strip-source-maps-"));
  roots.push(root);
  await mkdir(path.join(root, "esm", "http"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stripSourceMapSources", () => {
  it("drops sourcesContent and keeps sources, mappings and names", async () => {
    const root = await makeBuild();
    const mapPath = path.join(root, "esm", "http", "server.mjs.map");
    await writeFile(
      mapPath,
      JSON.stringify({
        version: 3,
        file: "server.mjs",
        names: ["start"],
        sources: ["../../src/http/server.ts"],
        sourcesContent: ["export function start() {}\n"],
        mappings: "AAAA",
      }),
    );

    assert.equal(await stripSourceMapSources(root), 1);

    assert.deepEqual(JSON.parse(await readFile(mapPath, "utf8")), {
      version: 3,
      file: "server.mjs",
      names: ["start"],
      sources: ["../../src/http/server.ts"],
      mappings: "AAAA",
    });
  });

  it("leaves maps without sourcesContent and non-map files untouched", async () => {
    const root = await makeBuild();
    const declarationMap = path.join(root, "esm", "index.d.mts.map");
    const code = path.join(root, "esm", "index.mjs");
    const declarationMapContent = '{"version":3,"sources":["../src/index.ts"],"mappings":";AAAA"}';
    await writeFile(declarationMap, declarationMapContent);
    await writeFile(code, "export {};\n//# sourceMappingURL=index.mjs.map\n");

    assert.equal(await stripSourceMapSources(root), 0);
    assert.equal(await readFile(declarationMap, "utf8"), declarationMapContent);
    assert.equal(await readFile(code, "utf8"), "export {};\n//# sourceMappingURL=index.mjs.map\n");
  });

  it("treats a missing build directory as nothing to strip", async () => {
    const root = await makeBuild();

    assert.equal(await stripSourceMapSources(path.join(root, "missing")), 0);
  });

  it("refuses a map that is not JSON instead of packing it silently", async () => {
    const root = await makeBuild();
    await writeFile(path.join(root, "esm", "broken.mjs.map"), "not json");

    await assert.rejects(() => stripSourceMapSources(root), /not valid JSON/);
  });
});
