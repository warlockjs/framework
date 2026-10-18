import { chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyCassette, loadCassette, saveCassette } from "./cassette-io";

describe("cassette disk permissions", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-cassette-modes-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "creates private directories and files under umask 0",
    async () => {
      const previous = process.umask(0);

      try {
        const parent = join(dir, "nested", "cassettes");
        const path = join(parent, "chat.json");
        const cassette = emptyCassette("test-model", "test-provider");
        await saveCassette(path, cassette);

        expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
        expect((await stat(parent)).mode & 0o777).toBe(0o700);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await loadCassette(path, "test-model", "test-provider")).toEqual(cassette);
        expect(await readdir(parent)).toEqual(["chat.json"]);
      } finally {
        process.umask(previous);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "makes rewrites exactly private and preserves user directories",
    async () => {
      const path = join(dir, "chat.json");
      await chmod(dir, 0o755);
      await writeFile(path, "{}", { mode: 0o644 });
      await chmod(path, 0o644);
      const previous = process.umask(0o777);

      try {
        await saveCassette(path, emptyCassette("test-model", "test-provider"));
        expect((await stat(dir)).mode & 0o777).toBe(0o755);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readdir(dir)).toEqual(["chat.json"]);
      } finally {
        process.umask(previous);
      }
    },
  );
});
