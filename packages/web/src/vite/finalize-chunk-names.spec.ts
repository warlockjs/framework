import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeChunkNames } from "./finalize-chunk-names";

const directories: string[] = [];

type Chunk = { code: string; isEntry?: boolean };

/** Writes chunks (name -> code) plus a manifest and a budget module report that name them. */
function build(chunks: Record<string, Chunk>): { directory: string; files: string[] } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-finalize-"));
  directories.push(directory);
  fs.mkdirSync(path.join(directory, "assets"), { recursive: true });
  fs.mkdirSync(path.join(directory, ".vite"), { recursive: true });

  const manifest: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {};

  for (const [name, chunk] of Object.entries(chunks)) {
    fs.writeFileSync(path.join(directory, "assets", name), chunk.code);
    manifest[`_${name}`] = { file: `assets/${name}`, imports: [] };
    modules[`assets/${name}`] = [{ id: name, bytes: chunk.code.length }];
  }

  fs.writeFileSync(path.join(directory, ".vite/manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, ".vite/budget-modules.json"), JSON.stringify(modules));

  return {
    directory,
    files: Object.entries(chunks).map(([name, chunk]) => `${chunk.isEntry ? "!" : ""}${name}`),
  };
}

async function finalize(chunks: Record<string, Chunk>) {
  const { directory, files } = build(chunks);
  const result = await finalizeChunkNames({
    outDir: directory,
    chunks: files.map((file) => ({
      fileName: `assets/${file.replace("!", "")}`,
      isEntry: file.startsWith("!"),
    })),
  });

  return { directory, result };
}

const emitted = (directory: string) => fs.readdirSync(path.join(directory, "assets")).sort();

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("finalizeChunkNames", () => {
  it("names a chunk after its final bytes, so a changed import changes the importer's name", async () => {
    // Both builds give the importer the same old name and the same old import
    // specifier; only the imported chunk's bytes differ.
    const importer = (code: string) => ({
      "api-QQQQQQQQ.js": { code: 'import "./leaf-AAAAAAAA.js";export const a=1;' },
      "leaf-AAAAAAAA.js": { code },
    });

    const first = await finalize(importer("export const r=1;"));
    const second = await finalize(importer("export const r=2;"));

    const apiOf = (directory: string) => emitted(directory).find((name) => name.startsWith("api-"));

    expect(apiOf(first.directory)).toBeDefined();
    expect(apiOf(first.directory)).not.toBe(apiOf(second.directory));
  });

  it("names equal bytes equally across builds, whatever the old hashes were", async () => {
    const make = (leaf: string, api: string) => ({
      [`api-${api}.js`]: { code: `import "./leaf-${leaf}.js";export const a=1;` },
      [`leaf-${leaf}.js`]: { code: "export const r=1;" },
    });

    const first = await finalize(make("AAAAAAAA", "QQQQQQQQ"));
    const second = await finalize(make("BBBBBBBB", "ZZZZZZZZ"));

    expect(emitted(first.directory)).toEqual(emitted(second.directory));
  });

  it("rewrites the importer to the final name of what it imports", async () => {
    const { directory } = await finalize({
      "api-QQQQQQQQ.js": { code: 'import "./leaf-AAAAAAAA.js";export const a=1;' },
      "leaf-AAAAAAAA.js": { code: "export const r=1;" },
    });
    const [api, leaf] = [
      emitted(directory).find((name) => name.startsWith("api-")) as string,
      emitted(directory).find((name) => name.startsWith("leaf-")) as string,
    ];

    expect(fs.readFileSync(path.join(directory, "assets", api), "utf8")).toContain(`./${leaf}`);
    expect(fs.readFileSync(path.join(directory, "assets", api), "utf8")).not.toContain("AAAAAAAA");
  });

  it("keeps one file for byte-identical chunks and points importers at it", async () => {
    const { directory, result } = await finalize({
      "main-MMMMMMMM.js": {
        code: 'import "./is-record-AAAAAAAA.js";import "./is-value-BBBBBBBB.js";',
        isEntry: true,
      },
      "is-record-AAAAAAAA.js": { code: "export const same=true;" },
      "is-value-BBBBBBBB.js": { code: "export const same=true;" },
    });

    expect(emitted(directory)).toHaveLength(2);
    expect(result.deduplicated.size).toBe(1);

    const main = emitted(directory).find((name) => name.startsWith("main-")) as string;
    const kept = emitted(directory).find((name) => !name.startsWith("main-")) as string;
    const code = fs.readFileSync(path.join(directory, "assets", main), "utf8");

    expect(code.match(new RegExp(`./${kept.replace(".", "\\.")}`, "g"))).toHaveLength(2);
  });

  it("never merges an entry chunk into another chunk", async () => {
    const { directory } = await finalize({
      "main-MMMMMMMM.js": { code: "export const same=true;", isEntry: true },
      "other-OOOOOOOO.js": { code: "export const same=true;" },
    });

    expect(emitted(directory)).toHaveLength(2);
  });

  it("rewrites the manifest and the budget module report to the final names", async () => {
    const { directory } = await finalize({
      "api-QQQQQQQQ.js": { code: 'import "./leaf-AAAAAAAA.js";export const a=1;' },
      "leaf-AAAAAAAA.js": { code: "export const r=1;" },
    });
    const files = emitted(directory);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, ".vite/manifest.json"), "utf8"),
    );
    const modules = JSON.parse(
      fs.readFileSync(path.join(directory, ".vite/budget-modules.json"), "utf8"),
    );

    expect(Object.keys(manifest).sort()).toEqual(files.map((file) => `_${file}`));
    expect(
      Object.values<{ file: string }>(manifest)
        .map((entry) => entry.file)
        .sort(),
    ).toEqual(files.map((file) => `assets/${file}`));
    expect(Object.keys(modules).sort()).toEqual(files.map((file) => `assets/${file}`));
  });

  it("rewrites preload dependency lists, which name chunks with their directory", async () => {
    const { directory } = await finalize({
      "main-MMMMMMMM.js": {
        code: 'const deps=["assets/lazy-LLLLLLLL.js"];import("./lazy-LLLLLLLL.js");',
        isEntry: true,
      },
      "lazy-LLLLLLLL.js": { code: "export const lazy=1;" },
    });
    const lazy = emitted(directory).find((name) => name.startsWith("lazy-")) as string;
    const main = emitted(directory).find((name) => name.startsWith("main-")) as string;
    const code = fs.readFileSync(path.join(directory, "assets", main), "utf8");

    expect(code).toContain(`"assets/${lazy}"`);
    expect(code).toContain(`"./${lazy}"`);
    expect(code).not.toContain("LLLLLLLL");
  });

  it("names chunks that import each other consistently and deterministically", async () => {
    const cyclic = {
      "x-XXXXXXXX.js": { code: 'import "./y-YYYYYYYY.js";export const x=1;' },
      "y-YYYYYYYY.js": { code: 'import "./x-XXXXXXXX.js";export const y=1;' },
    };

    const first = await finalize(cyclic);
    const second = await finalize(cyclic);
    const [x, y] = [
      emitted(first.directory).find((name) => name.startsWith("x-")) as string,
      emitted(first.directory).find((name) => name.startsWith("y-")) as string,
    ];

    expect(emitted(first.directory)).toEqual(emitted(second.directory));
    expect(fs.readFileSync(path.join(first.directory, "assets", x), "utf8")).toContain(`./${y}`);
    expect(fs.readFileSync(path.join(first.directory, "assets", y), "utf8")).toContain(`./${x}`);
  });

  it("changing a chunk inside a cycle renames the whole cycle", async () => {
    const cycle = (code: string) => ({
      "x-XXXXXXXX.js": { code: `import "./y-YYYYYYYY.js";${code}` },
      "y-YYYYYYYY.js": { code: 'import "./x-XXXXXXXX.js";export const y=1;' },
    });

    const first = await finalize(cycle("export const x=1;"));
    const second = await finalize(cycle("export const x=2;"));

    const yOf = (directory: string) => emitted(directory).find((name) => name.startsWith("y-"));

    expect(yOf(first.directory)).not.toBe(yOf(second.directory));
  });

  it("does nothing when the build emitted no chunks", async () => {
    const { directory } = build({});
    const result = await finalizeChunkNames({ outDir: directory, chunks: [] });

    expect(result.renamed.size).toBe(0);
  });
});
