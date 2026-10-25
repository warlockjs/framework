import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertChunkIntegrity,
  CHUNK_INTEGRITY_FILE,
  ChunkIntegrityError,
  findChunkIntegrityConflicts,
  readChunkIntegrity,
  recordChunkIntegrity,
  writeChunkIntegrity,
} from "./chunk-integrity";

const directories: string[] = [];

function outDir(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-integrity-"));
  directories.push(directory);

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("recordChunkIntegrity", () => {
  it("digests every asset and skips precompressed siblings", async () => {
    const directory = outDir({
      "assets/a-12345678.js": "a",
      "assets/a-12345678.js.br": "x",
      "assets/a-12345678.js.gz": "x",
      "assets/nested/b.css": "b",
      ".vite/manifest.json": "{}",
    });

    const record = await recordChunkIntegrity(directory);

    expect(Object.keys(record.files)).toEqual(["assets/a-12345678.js", "assets/nested/b.css"]);
  });

  it("is empty when there is no assets directory", async () => {
    expect((await recordChunkIntegrity(outDir({}))).files).toEqual({});
  });
});

describe("chunk integrity check", () => {
  it("passes when names map to the same bytes or are new", () => {
    const previous = { version: 1 as const, files: { "assets/a.js": "d1" } };

    expect(() =>
      assertChunkIntegrity(previous, {
        version: 1,
        files: { "assets/a.js": "d1", "assets/b.js": "d2" },
      }),
    ).not.toThrow();
  });

  it("passes on a first build", () => {
    expect(() =>
      assertChunkIntegrity(undefined, { version: 1, files: { "assets/a.js": "d1" } }),
    ).not.toThrow();
  });

  it("names every file whose bytes changed under the same name", () => {
    const previous = { version: 1 as const, files: { "assets/a.js": "d1", "assets/c.js": "d3" } };
    const current = { version: 1 as const, files: { "assets/a.js": "d9", "assets/c.js": "d3" } };

    expect(findChunkIntegrityConflicts(previous, current)).toEqual([
      { file: "assets/a.js", previous: "d1", current: "d9" },
    ]);
    expect(() => assertChunkIntegrity(previous, current)).toThrow(ChunkIntegrityError);
    expect(() => assertChunkIntegrity(previous, current)).toThrow(/assets\/a\.js/);
  });
});

describe("readChunkIntegrity", () => {
  it("reads a record from a client directory, a build directory or the file itself", async () => {
    const directory = outDir({});
    const record = { version: 1 as const, files: { "assets/a.js": "d1" } };
    await writeChunkIntegrity(path.join(directory, "client"), record);

    expect(await readChunkIntegrity(directory)).toEqual(record);
    expect(await readChunkIntegrity(path.join(directory, "client"))).toEqual(record);
    expect(
      await readChunkIntegrity(path.join(directory, "client", CHUNK_INTEGRITY_FILE)),
    ).toEqual(record);
  });

  it("is undefined when no record exists", async () => {
    expect(await readChunkIntegrity(outDir({}))).toBeUndefined();
  });

  it("refuses a record that is not valid", async () => {
    const broken = outDir({ [CHUNK_INTEGRITY_FILE]: "{ nope" });
    await expect(readChunkIntegrity(broken)).rejects.toThrow(/not valid JSON/);

    const wrong = outDir({ [CHUNK_INTEGRITY_FILE]: JSON.stringify({ version: 2 }) });
    await expect(readChunkIntegrity(wrong)).rejects.toThrow(/version 1/);
  });
});
