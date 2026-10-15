import { beforeEach, describe, expect, it, vi } from "vitest";

const fileExistsAsync = vi.fn(async () => true);
const getJsonFileAsync = vi.fn();
const putJsonFileAsync = vi.fn(async () => undefined);
const ensureDirectoryAsync = vi.fn(async () => undefined);
const unlinkAsync = vi.fn(async () => undefined);

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: (...args: unknown[]) => fileExistsAsync(...(args as [])),
  getJsonFileAsync: (...args: unknown[]) => getJsonFileAsync(...(args as [])),
  putJsonFileAsync: (...args: unknown[]) => putJsonFileAsync(...(args as [])),
  ensureDirectoryAsync: (...args: unknown[]) => ensureDirectoryAsync(...(args as [])),
  unlinkAsync: (...args: unknown[]) => unlinkAsync(...(args as [])),
}));

vi.mock("../../../src/utils/paths", () => ({
  warlockPath: (...parts: string[]) => ["/project/.warlock", ...parts].join("/"),
}));

const { CACHE_TTL_MS, clearCachedLatestVersion, readCachedLatestVersion, writeCachedLatestVersion } =
  await import("../../../src/dev-server/update-check-cache");

const NOW = 1_800_000_000_000;

describe("update-check cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileExistsAsync.mockResolvedValue(true);
  });

  describe("readCachedLatestVersion", () => {
    it("returns a version recorded within the TTL", async () => {
      getJsonFileAsync.mockResolvedValue({ checkedAt: NOW - 1000, latest: "4.9.0" });

      await expect(readCachedLatestVersion(NOW)).resolves.toBe("4.9.0");
    });

    it("ignores an entry older than the TTL", async () => {
      getJsonFileAsync.mockResolvedValue({ checkedAt: NOW - CACHE_TTL_MS - 1, latest: "4.9.0" });

      await expect(readCachedLatestVersion(NOW)).resolves.toBeUndefined();
    });

    it("ignores an entry stamped in the future, so a backwards clock cannot pin it", async () => {
      getJsonFileAsync.mockResolvedValue({ checkedAt: NOW + 60_000, latest: "4.9.0" });

      await expect(readCachedLatestVersion(NOW)).resolves.toBeUndefined();
    });

    it("returns undefined when there is no cache file", async () => {
      fileExistsAsync.mockResolvedValue(false);

      await expect(readCachedLatestVersion(NOW)).resolves.toBeUndefined();
      expect(getJsonFileAsync).not.toHaveBeenCalled();
    });

    it.each([
      ["malformed json", () => getJsonFileAsync.mockRejectedValue(new SyntaxError("bad json"))],
      ["a missing timestamp", () => getJsonFileAsync.mockResolvedValue({ latest: "4.9.0" })],
      ["a missing version", () => getJsonFileAsync.mockResolvedValue({ checkedAt: NOW })],
      ["a non-string version", () =>
        getJsonFileAsync.mockResolvedValue({ checkedAt: NOW, latest: 49 })],
      ["a non-object payload", () => getJsonFileAsync.mockResolvedValue("nope")],
    ])("survives %s", async (_label, arrange) => {
      arrange();

      await expect(readCachedLatestVersion(NOW)).resolves.toBeUndefined();
    });
  });

  describe("writeCachedLatestVersion", () => {
    it("records the version with a timestamp", async () => {
      await writeCachedLatestVersion("4.9.0", NOW);

      expect(ensureDirectoryAsync).toHaveBeenCalledWith("/project/.warlock");
      expect(putJsonFileAsync).toHaveBeenCalledWith("/project/.warlock/update-check.json", {
        checkedAt: NOW,
        latest: "4.9.0",
      });
    });

    it("never throws when the write fails", async () => {
      putJsonFileAsync.mockRejectedValue(new Error("EACCES"));

      await expect(writeCachedLatestVersion("4.9.0", NOW)).resolves.toBeUndefined();
    });
  });

  describe("clearCachedLatestVersion", () => {
    it("removes the file when it exists", async () => {
      await clearCachedLatestVersion();

      expect(unlinkAsync).toHaveBeenCalledWith("/project/.warlock/update-check.json");
    });

    it("does nothing when there is no file", async () => {
      fileExistsAsync.mockResolvedValue(false);

      await clearCachedLatestVersion();

      expect(unlinkAsync).not.toHaveBeenCalled();
    });

    it("never throws when the delete fails", async () => {
      unlinkAsync.mockRejectedValue(new Error("EBUSY"));

      await expect(clearCachedLatestVersion()).resolves.toBeUndefined();
    });
  });
});
