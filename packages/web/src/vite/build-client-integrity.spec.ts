import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHydrationClient } from "./build-client";
import { ChunkIntegrityError, CHUNK_INTEGRITY_FILE } from "./chunk-integrity";

const vite = vi.hoisted(() => ({
  build: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn() })),
  version: "8.3.3",
}));

vi.mock("vite", () => vite);

const directories: string[] = [];

function tempOutDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-build-client-"));
  directories.push(directory);
  return path.join(directory, "client");
}

/** Makes the mocked Vite build "emit" the given chunks into the output directory. */
function emitChunks(outDir: string, chunks: Record<string, string>): void {
  vite.build.mockImplementationOnce(async () => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
    fs.mkdirSync(path.join(outDir, ".vite"), { recursive: true });
    fs.writeFileSync(path.join(outDir, ".vite/manifest.json"), "{}");

    for (const [name, code] of Object.entries(chunks)) {
      fs.writeFileSync(path.join(outDir, "assets", name), code);
    }

    return {
      output: Object.keys(chunks).map((name) => ({
        type: "chunk",
        fileName: `assets/${name}`,
        isEntry: name.startsWith("hydration"),
      })),
    };
  });
}

const run = (outDir: string, extra: object = {}) =>
  buildHydrationClient({
    webRoot: process.cwd(),
    outDir,
    plugins: [{ name: "fixture" }],
    resolveAliases: { "app/": "/repo/app/src/" },
    ...extra,
  });

afterEach(() => {
  vite.build.mockReset();

  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildHydrationClient chunk names", () => {
  it("renames chunks after their final bytes and records them", async () => {
    const outDir = tempOutDir();
    emitChunks(outDir, {
      "hydration-AAAAAAAA.js": 'import "./leaf-BBBBBBBB.js";',
      "leaf-BBBBBBBB.js": "export const r=1;",
    });

    await run(outDir);

    const record = JSON.parse(fs.readFileSync(path.join(outDir, CHUNK_INTEGRITY_FILE), "utf8"));
    const files = fs.readdirSync(path.join(outDir, "assets"));

    expect(Object.keys(record.files).sort()).toEqual(files.map((file) => `assets/${file}`).sort());
    expect(files.join()).not.toContain("BBBBBBBB");
  });

  it("fails when a name the previous build used now maps to different bytes", async () => {
    const outDir = tempOutDir();
    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });
    await run(outDir);

    // Same final name is only possible with the same bytes, so forge a previous
    // record that claims the emitted name held other bytes.
    const [name] = fs.readdirSync(path.join(outDir, "assets"));
    const forged = { version: 1 as const, files: { [`assets/${name}`]: "other-bytes" } };

    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });

    await expect(run(outDir, { previousIntegrity: forged })).rejects.toThrow(ChunkIntegrityError);

    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });

    await expect(run(outDir, { previousIntegrity: forged })).rejects.toThrow(
      new RegExp(`assets/${name}`),
    );
  });

  it("reads the record the output directory holds when none is passed", async () => {
    const outDir = tempOutDir();
    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });
    await run(outDir);

    const recordFile = path.join(outDir, CHUNK_INTEGRITY_FILE);
    const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    const [name] = Object.keys(record.files);
    record.files[name as string] = "tampered";
    fs.writeFileSync(recordFile, JSON.stringify(record));

    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });

    await expect(run(outDir)).rejects.toThrow(ChunkIntegrityError);
  });

  it("passes a rebuild of the same sources", async () => {
    const outDir = tempOutDir();
    emitChunks(outDir, { "hydration-AAAAAAAA.js": "export const a=1;" });
    await run(outDir);

    emitChunks(outDir, { "hydration-ZZZZZZZZ.js": "export const a=1;" });

    await expect(run(outDir)).resolves.toBeDefined();
  });
});
