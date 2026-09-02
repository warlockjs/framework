import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `stageDistAsync`'s swap-in step (rename the temp build over an existing
 * `dist`) is the one place a THROW — not a hard crash, an exception our own
 * code can hit (permissions, a locked file on Windows) — could otherwise
 * leave `dist` missing. These exercise that failure path with the renames
 * mocked, since forcing a real `fs.rename` to fail mid-flight isn't portable.
 * The happy paths (no previous dist, wholesale replacement of a stale one,
 * and the post-stage rollback) are covered against the real filesystem in
 * `dist-promotion.test.ts`.
 */

const renameFileAsync = vi.hoisted(() => vi.fn(async (_from: string, _to: string) => undefined));
const directoryExistsAsync = vi.hoisted(() => vi.fn(async () => true));
const removeDirectoryAsync = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@warlock.js/fs", () => ({
  directoryExistsAsync,
  removeDirectoryAsync,
  renameFileAsync,
}));

const { commitDistAsync, rollbackDistAsync, stageDistAsync } = await import(
  "../../../src/production/promote-dist"
);

describe("stageDistAsync", () => {
  beforeEach(() => {
    renameFileAsync.mockReset();
    removeDirectoryAsync.mockClear();
    directoryExistsAsync.mockReset();
    directoryExistsAsync.mockResolvedValue(true);
  });

  it("parks the previous dist rather than deleting it, and drops it only on commit", async () => {
    const calls: Array<[string, string]> = [];
    renameFileAsync.mockImplementation(async (from: string, to: string) => {
      calls.push([from, to]);
    });

    const staged = await stageDistAsync("/app/.dist.build-x", "/app/dist");

    // 1: dist -> stale, 2: temp -> dist
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(["/app/.dist.build-x", "/app/dist"]);
    expect(staged.outDir).toBe("/app/dist");
    expect(staged.previousDir).toBe(calls[0]![1]);

    // Staging alone must NOT delete the previous build — the emit hooks that
    // run next can still fail, and it is what a rollback restores.
    expect(removeDirectoryAsync).not.toHaveBeenCalled();

    await commitDistAsync(staged);

    expect(removeDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(removeDirectoryAsync).toHaveBeenCalledWith(staged.previousDir);
  });

  it("moves the previous dist back into place and rethrows, rather than leaving dist missing", async () => {
    const calls: Array<[string, string]> = [];

    renameFileAsync.mockImplementation(async (from: string, to: string) => {
      calls.push([from, to]);

      // Second rename is the swap-in (tempDir -> outDir) — fail it.
      if (calls.length === 2) {
        throw new Error("EPERM: simulated mid-promotion failure");
      }
    });

    await expect(stageDistAsync("/app/.dist.build-x", "/app/dist")).rejects.toThrow(
      "simulated mid-promotion failure",
    );

    // 1: dist -> stale, 2: temp -> dist (fails), 3: stale -> dist (rollback)
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["/app/dist", calls[0]![1]]);
    expect(calls[1]).toEqual(["/app/.dist.build-x", "/app/dist"]);
    expect(calls[2]).toEqual([calls[0]![1], "/app/dist"]);

    // The stale directory is never deleted on the failure path — it is what
    // gets renamed back onto `dist`.
    expect(removeDirectoryAsync).not.toHaveBeenCalled();
  });

  it("promotes with a single rename when no previous dist exists", async () => {
    directoryExistsAsync.mockResolvedValue(false);

    const staged = await stageDistAsync("/app/.dist.build-x", "/app/dist");

    expect(renameFileAsync).toHaveBeenCalledTimes(1);
    expect(renameFileAsync).toHaveBeenCalledWith("/app/.dist.build-x", "/app/dist");
    expect(staged.previousDir).toBeUndefined();

    await commitDistAsync(staged);

    // Nothing was parked, so nothing is there to drop.
    expect(removeDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe("rollbackDistAsync", () => {
  beforeEach(() => {
    // Rollback awaits `.catch(...)` on every call, so the mocks must hand
    // back real promises — a bare `mockReset()` leaves them returning
    // `undefined` and the rollback would die on `.catch` of nothing.
    renameFileAsync.mockReset();
    renameFileAsync.mockResolvedValue(undefined);
    removeDirectoryAsync.mockReset();
    removeDirectoryAsync.mockResolvedValue(undefined);
    directoryExistsAsync.mockReset();
    directoryExistsAsync.mockResolvedValue(true);
  });

  it("renames the half-finished dist aside before restoring the previous one", async () => {
    const calls: Array<[string, string]> = [];
    renameFileAsync.mockImplementation(async (from: string, to: string) => {
      calls.push([from, to]);
    });

    await rollbackDistAsync({ outDir: "/app/dist", previousDir: "/app/dist.stale-abc" });

    // 1: dist -> failed-aside, 2: stale -> dist. Renames, not a recursive
    // delete of `dist`, so it is never observable as a partial tree.
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe("/app/dist");
    expect(calls[0]![1]).toContain(".failed-");
    expect(calls[1]).toEqual(["/app/dist.stale-abc", "/app/dist"]);

    // The discarded build is cleaned up, the restored one is not touched.
    expect(removeDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(removeDirectoryAsync).toHaveBeenCalledWith(calls[0]![1]);
  });

  it("removes dist outright when there was no previous build to restore", async () => {
    await rollbackDistAsync({ outDir: "/app/dist" });

    expect(renameFileAsync).not.toHaveBeenCalled();
    expect(removeDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(removeDirectoryAsync).toHaveBeenCalledWith("/app/dist");
  });

  it("never throws, so it cannot mask the build error it is unwinding", async () => {
    renameFileAsync.mockRejectedValue(new Error("EPERM: rollback rename failed"));
    removeDirectoryAsync.mockRejectedValue(new Error("EBUSY: rollback delete failed"));

    await expect(
      rollbackDistAsync({ outDir: "/app/dist", previousDir: "/app/dist.stale-abc" }),
    ).resolves.toBeUndefined();
  });
});
