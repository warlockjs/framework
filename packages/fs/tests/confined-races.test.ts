import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { withTempDir } from "./helpers";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    lstat: vi.fn(original.lstat),
    open: vi.fn(original.open),
    opendir: vi.fn(original.opendir),
  };
});

const { createConfinedReader, FsLimitExceededError, FsLinkRefusedError } = await import("../src");

const { appendFile, lstat, mkdir, open, opendir, rename, rm, symlink, writeFile } = actualFs;
const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

posixOnly("confined reader — check-then-use races", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ dir, cleanup } = await withTempDir());
    root = path.join(dir, "root");
    outside = path.join(dir, "outside");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, "nested", "data.txt"), "inside");
    await writeFile(path.join(outside, "data.txt"), "top secret");
  });

  afterEach(async () => {
    vi.mocked(lstat).mockImplementation(original.lstat);
    vi.mocked(open).mockImplementation(original.open);
    vi.mocked(opendir).mockImplementation(original.opendir);
    await cleanup();
  });

  it("opens files with O_NOFOLLOW", async () => {
    const reader = createConfinedReader(root);

    await reader.readText("nested/data.txt");

    const flags = vi.mocked(open).mock.calls[0]?.[1];

    expect(typeof flags).toBe("number");
    expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });

  it("refuses a file swapped for a symlink between the check and the open", async () => {
    const target = path.join(root, "nested", "data.txt");

    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      await rm(target);
      await symlink(path.join(outside, "data.txt"), target);
      return original.open(file, flags);
    });

    const error = await caught(createConfinedReader(root).readText("nested/data.txt"));

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed", linkPath: "nested/data.txt" });
  });

  it("refuses a file replaced by another file between the check and the open", async () => {
    const target = path.join(root, "nested", "data.txt");

    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      await writeFile(path.join(root, "replacement.txt"), "swapped");
      await rename(path.join(root, "replacement.txt"), target);
      return original.open(file, flags);
    });

    const error = await caught(createConfinedReader(root).readText("nested/data.txt"));

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed" });
  });

  it("refuses a parent folder swapped for a symlink between the check and the open", async () => {
    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      await rename(path.join(root, "nested"), path.join(root, "moved"));
      await symlink(outside, path.join(root, "nested"));
      return original.open(file, flags);
    });

    const error = await caught(createConfinedReader(root).readText("nested/data.txt"));

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed" });
  });

  it("stops reading a file that grows after it was checked", async () => {
    const target = path.join(root, "nested", "data.txt");

    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      const handle = await original.open(file, flags);
      const stat = handle.stat.bind(handle);

      // Grow the file after the size check and after the handle's identity
      // check, so only the bound applied while reading can stop it.
      handle.stat = (async (options?: { bigint?: boolean }) => {
        const stats = await stat(options);
        await appendFile(target, Buffer.alloc(200_000, 0x61));
        return stats;
      }) as typeof handle.stat;

      return handle;
    });

    const error = await caught(
      createConfinedReader(root, { maxFileBytes: 100 }).readText("nested/data.txt"),
    );

    expect(error).toBeInstanceOf(FsLimitExceededError);
    expect(error).toMatchObject({ limit: "maxFileBytes", max: 100, actual: 101 });
  });

  it("refuses a folder swapped for a symlink before it is listed", async () => {
    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      await rename(path.join(root, "nested"), path.join(root, "moved"));
      await symlink(outside, path.join(root, "nested"));
      return original.open(file, flags);
    });

    const error = await caught(createConfinedReader(root).list("nested"));

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed" });
  });

  it("refuses a folder replaced while it is read by path (no /proc fallback)", async () => {
    vi.mocked(lstat).mockImplementation(async (file, options) => {
      if (String(file).startsWith("/proc/self/fd/")) {
        throw Object.assign(new Error("no /proc"), { code: "ENOENT" });
      }
      return original.lstat(file, options);
    });
    vi.mocked(opendir).mockImplementationOnce(async (file, options) => {
      const handle = await original.opendir(file, options);
      await rename(path.join(root, "nested"), path.join(root, "moved"));
      await mkdir(path.join(root, "nested"));
      return handle;
    });

    const error = await caught(createConfinedReader(root).list("nested"));

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed" });
  });

  it("reads folders through the checked descriptor on Linux", async () => {
    if (process.platform !== "linux") return;

    const entries = await createConfinedReader(root).list("nested");

    expect(entries.map((entry) => entry.name)).toEqual(["data.txt"]);
    expect(String(vi.mocked(opendir).mock.calls[0]?.[0])).toMatch(/^\/proc\/self\/fd\/\d+$/);
  });
});
