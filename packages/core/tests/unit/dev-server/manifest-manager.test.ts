import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";
import { ManifestManager } from "../../../src/dev-server/manifest-manager";
import type { FileManifest } from "../../../src/dev-server/types";

/**
 * Stub the filesystem layer so `init()` / `save()` are exercised without
 * touching the real `.warlock/manifest.json`. Each test controls what the
 * fake fs reports.
 */
const fsMocks = vi.hoisted(() => ({
  fileExistsAsync: vi.fn(),
  getJsonFileAsync: vi.fn(),
  putFileAsync: vi.fn(),
}));

vi.mock("@warlock.js/fs", () => fsMocks);

function manifestEntry(overrides: Partial<FileManifest> = {}): FileManifest {
  return {
    absolutePath: "/abs/src/app/store/a.ts",
    relativePath: "src/app/store/a.ts",
    lastModified: 1,
    hash: "hash-a",
    dependencies: [],
    dependents: [],
    type: "other",
    ...overrides,
  };
}

describe("ManifestManager — in-memory CRUD", () => {
  let manager: ManifestManager;

  beforeEach(() => {
    manager = new ManifestManager(new Map<string, FileManager>());
  });

  it("setFile then getFile round-trips an entry", () => {
    const entry = manifestEntry();

    manager.setFile("src/app/store/a.ts", entry);

    expect(manager.getFile("src/app/store/a.ts")).toEqual(entry);
  });

  it("getFile returns undefined for an unknown path", () => {
    expect(manager.getFile("nope.ts")).toBeUndefined();
  });

  it("hasFile reflects presence", () => {
    manager.setFile("a.ts", manifestEntry());

    expect(manager.hasFile("a.ts")).toBe(true);
    expect(manager.hasFile("b.ts")).toBe(false);
  });

  it("removeFile deletes an entry", () => {
    manager.setFile("a.ts", manifestEntry());
    manager.removeFile("a.ts");

    expect(manager.hasFile("a.ts")).toBe(false);
  });

  it("getAllFilePaths lists every stored path", () => {
    manager.setFile("a.ts", manifestEntry());
    manager.setFile("b.ts", manifestEntry());

    expect(manager.getAllFilePaths().sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("clear empties files and resets stats", () => {
    manager.setFile("a.ts", manifestEntry());

    manager.clear();

    expect(manager.getAllFilePaths()).toEqual([]);
    expect(manager.getMetadata().stats).toEqual({ totalFiles: 0, totalDependencies: 0 });
  });
});

describe("ManifestManager — init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false and keeps defaults when no manifest exists", async () => {
    fsMocks.fileExistsAsync.mockResolvedValue(false);

    const manager = new ManifestManager(new Map());

    expect(await manager.init()).toBe(false);
    expect(fsMocks.getJsonFileAsync).not.toHaveBeenCalled();
  });

  it("loads the manifest from disk and returns true when it exists", async () => {
    fsMocks.fileExistsAsync.mockResolvedValue(true);
    fsMocks.getJsonFileAsync.mockResolvedValue({
      version: "1.0.0",
      lastBuildTime: 123,
      stats: { totalFiles: 1, totalDependencies: 0 },
      files: { "a.ts": manifestEntry() },
    });

    const manager = new ManifestManager(new Map());

    expect(await manager.init()).toBe(true);
    expect(manager.hasFile("a.ts")).toBe(true);
  });
});

describe("ManifestManager — save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.putFileAsync.mockResolvedValue(undefined);
  });

  it("recomputes stats and writes serialized JSON", async () => {
    const manager = new ManifestManager(new Map());

    manager.setFile("a.ts", manifestEntry({ dependencies: ["b.ts", "c.ts"] }));
    manager.setFile("b.ts", manifestEntry({ dependencies: ["c.ts"] }));

    await manager.save();

    expect(fsMocks.putFileAsync).toHaveBeenCalledOnce();

    const [, written] = fsMocks.putFileAsync.mock.calls[0];
    const parsed = JSON.parse(written as string);

    expect(parsed.stats.totalFiles).toBe(2);
    expect(parsed.stats.totalDependencies).toBe(3);
    expect(parsed.files["a.ts"].hash).toBe("hash-a");
  });

  it("refreshes lastBuildTime on save", async () => {
    const manager = new ManifestManager(new Map());
    const before = manager.getMetadata().lastBuildTime;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.save();

    expect(manager.getMetadata().lastBuildTime).toBeGreaterThanOrEqual(before);
  });
});
