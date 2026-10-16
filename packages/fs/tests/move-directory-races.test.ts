import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs/promises";
import type { PathLike } from "node:fs";
import path from "node:path";
import { withTempDir } from "./helpers";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    lstat: vi.fn(original.lstat),
    mkdir: vi.fn(original.mkdir),
    rename: vi.fn(original.rename),
    rmdir: vi.fn(original.rmdir),
  };
});

const { directoryIdentityAsync, DirectoryMoveError, moveDirectoryNoReplaceAsync } =
  await import("../src/move-directory");

const { lstat, mkdir, readFile, rename, rmdir, writeFile } = actualFs;
const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function moveError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DirectoryMoveError);
  return error as InstanceType<typeof DirectoryMoveError>;
}

posixOnly("moveDirectoryNoReplaceAsync — interleavings", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let source: string;
  let destination: string;
  const original = {
    lstat: vi.mocked(lstat).getMockImplementation()!,
    mkdir: vi.mocked(mkdir).getMockImplementation()!,
    rename: vi.mocked(rename).getMockImplementation()!,
    rmdir: vi.mocked(rmdir).getMockImplementation()!,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ dir, cleanup } = await withTempDir());
    source = path.join(dir, "feature");
    destination = path.join(dir, "archive");
    await original.mkdir(source);
    await writeFile(path.join(source, "receipt.json"), "kept");
  });

  afterEach(async () => {
    vi.mocked(lstat).mockImplementation(original.lstat);
    vi.mocked(mkdir).mockImplementation(original.mkdir);
    vi.mocked(rename).mockImplementation(original.rename);
    vi.mocked(rmdir).mockImplementation(original.rmdir);
    await cleanup();
  });

  it("refuses when another process writes into the claimed destination", async () => {
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await writeFile(path.join(String(to), "foreign.txt"), "theirs");
      return original.rename(from, to);
    });

    const error = await moveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.reason).toBe("destination-exists");
    expect(error.outcome).toBe("not-moved");
    expect(await readFile(path.join(destination, "foreign.txt"), "utf8")).toBe("theirs");
    expect(await readFile(path.join(source, "receipt.json"), "utf8")).toBe("kept");
  });

  it("refuses when the claimed placeholder is swapped for another directory", async () => {
    const foreign = path.join(dir, "foreign");
    await original.mkdir(foreign);
    const foreignIdentity = await directoryIdentityAsync(foreign);

    // Swap right after the placeholder's identity has been recorded (the
    // first lstat of the destination), before the rename.
    let swapped = false;
    const lstatThenSwap = async (target: PathLike) => {
      const stats = await original.lstat(target);

      if (!swapped && String(target) === destination) {
        swapped = true;
        await rmdir(destination);
        await original.rename(foreign, destination);
      }

      return stats;
    };
    vi.mocked(lstat).mockImplementation(lstatThenSwap as typeof lstat);

    const error = await moveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.reason).toBe("placeholder-replaced");
    expect(error.outcome).toBe("not-moved");
    expect(rename).not.toHaveBeenCalledWith(source, destination);
    expect(await directoryIdentityAsync(destination)).toEqual(foreignIdentity);
    expect(await readFile(path.join(source, "receipt.json"), "utf8")).toBe("kept");
  });

  it.each(["before the first identity read", "after the final identity check"])(
    "documents an uncooperative empty-directory swap %s",
    async (window) => {
      const foreign = path.join(dir, "foreign");
      await original.mkdir(foreign);
      const sourceIdentity = await directoryIdentityAsync(source);
      const foreignIdentity = await directoryIdentityAsync(foreign);
      const swap = async () => {
        await original.rmdir(destination);
        await original.rename(foreign, destination);
      };
      if (window === "before the first identity read") {
        let swapped = false;
        const swapThenLstat = async (target: PathLike) => {
          if (!swapped && String(target) === destination) {
            swapped = true;
            await swap();
          }
          return original.lstat(target);
        };
        vi.mocked(lstat).mockImplementation(swapThenLstat as typeof lstat);
      } else {
        vi.mocked(rename).mockImplementationOnce(async (from, to) => {
          await swap();
          return original.rename(from, to);
        });
      }
      // Both swaps evade the sequential checks: the documented limit is a
      // successful move that silently replaces the other empty directory.
      const result = await moveDirectoryNoReplaceAsync(source, destination);
      expect(result.type).toBe("moved");
      expect(await directoryIdentityAsync(destination)).toEqual(sourceIdentity);
      expect(await directoryIdentityAsync(destination)).not.toEqual(foreignIdentity);
      expect(await readFile(path.join(destination, "receipt.json"), "utf8")).toBe("kept");
      await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("reports a cross-device rename as not moved and releases the claim", async () => {
    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    const error = await moveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.reason).toBe("cross-device");
    expect(error.outcome).toBe("not-moved");
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(source, "receipt.json"), "utf8")).toBe("kept");
  });

  it("classifies an unexpected rename error by where the directory actually is", async () => {
    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    const notMoved = await moveError(moveDirectoryNoReplaceAsync(source, destination));
    expect(notMoved.reason).toBe("rename-failed");
    expect(notMoved.outcome).toBe("not-moved");
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });

    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await original.rename(from, to);
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    const moved = await moveError(moveDirectoryNoReplaceAsync(source, destination));
    expect(moved.outcome).toBe("moved");

    // The source vanishes just before the rename while our own placeholder
    // is untouched: the rename certainly did not land, so this is not-moved
    // and the claim is released (a retry is not blocked by a stray dir).
    const elsewhere = path.join(dir, "elsewhere");
    vi.mocked(rename).mockImplementationOnce(async (from) => {
      await original.rename(from, elsewhere);
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    const vanished = await moveError(moveDirectoryNoReplaceAsync(destination, source));
    expect(vanished.outcome).toBe("not-moved");
    expect(vanished.reason).toBe("source-identity-mismatch");
    await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });

    // Neither location holds what we expect (source gone, placeholder
    // replaced by a stranger): only then is the outcome uncertain.
    const third = path.join(dir, "third");
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await original.rename(from, third);
      // Make the stranger while the placeholder still exists, so the file
      // system cannot hand it the placeholder's freed inode (ext4 reuses
      // them at once, which would make the stranger look like our claim).
      const stranger = path.join(dir, "stranger");
      await original.mkdir(stranger);
      await original.rmdir(to);
      await original.rename(stranger, String(to));
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    const uncertain = await moveError(moveDirectoryNoReplaceAsync(elsewhere, source));
    expect(uncertain.outcome).toBe("uncertain");
  });

  it("reports a placeholder it could not remove instead of hiding it", async () => {
    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });
    vi.mocked(rmdir).mockImplementationOnce(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    const error = await moveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(error.outcome).toBe("not-moved");
    expect(error.reason).toBe("rename-failed");
    expect(error.placeholderCleanupError).toMatchObject({ code: "EACCES" });
    expect(error.message).toContain("could not be removed");
    // The empty placeholder really is still there.
    expect((await lstat(destination)).isDirectory()).toBe(true);
  });

  it("never falls back to copy + delete", async () => {
    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    await moveError(moveDirectoryNoReplaceAsync(source, destination));

    expect(await readFile(path.join(source, "receipt.json"), "utf8")).toBe("kept");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
