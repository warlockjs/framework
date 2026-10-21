import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../storage";
import { storageFake, TEST_STORAGE_ROOT_ENV_KEY } from "./storage-fake";
import { installTestFakes, restoreTestFakes } from "./test-fakes";

afterEach(async () => {
  await restoreTestFakes();
  vi.unstubAllEnvs();
});
describe("private storage at worker file boundaries", () => {
  it("resets owned storage without replacing or deleting the shared HTTP root", async () => {
    const shared = await mkdtemp(path.join(os.tmpdir(), "warlock-shared-storage-"));
    const sentinel = path.join(shared, "shared.txt");
    await writeFile(sentinel, "shared");
    vi.stubEnv(TEST_STORAGE_ROOT_ENV_KEY, shared);
    const selection = {
      storage: true,
      mail: false,
      queue: false,
      cache: false,
      clock: false,
      ids: false,
      secrets: false,
    };
    try {
      await installTestFakes(selection, { isolatedStorage: true });
      const first = storageFake.root();
      expect(first).not.toBe(shared);
      expect(process.env[TEST_STORAGE_ROOT_ENV_KEY]).toBe(shared);
      await storage.put(Buffer.from("fixture"), "fixture.txt");
      await restoreTestFakes();
      expect(existsSync(first)).toBe(false);
      await installTestFakes(selection, { isolatedStorage: true });
      expect(storageFake.files()).toEqual([]);
      expect(await readFile(sentinel, "utf8")).toBe("shared");
      expect(process.env[TEST_STORAGE_ROOT_ENV_KEY]).toBe(shared);
    } finally {
      await restoreTestFakes();
      await rm(shared, { recursive: true, force: true });
    }
  });
});
