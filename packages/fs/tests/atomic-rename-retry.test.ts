import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteAsync, AtomicWriteError } from "../src/index.js";
import { withTempDir } from "./helpers.js";

/**
 * Only `rename` is mocked — `mkdir`/`writeFile`/`unlink` hit the real
 * filesystem via a temp dir, so these tests observe real content and real
 * leftover-temp-file behaviour around a simulated transient rename failure.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
  };
});

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function tempFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((entry) => entry.endsWith(".tmp"));
}

describe("atomic write — rename retry on transient Windows locks", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let renameMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
    const fsPromises = await import("node:fs/promises");
    renameMock = vi.mocked(fsPromises.rename) as unknown as ReturnType<typeof vi.fn>;
    renameMock.mockClear();
  });

  afterEach(async () => {
    renameMock.mockReset();
    await cleanup();
  });

  it("retries on EPERM and succeeds once the lock clears, with correct content and no leftover temp file", async () => {
    const target = path.join(dir, "config.json");
    const realRename = (
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
    ).rename;

    renameMock
      .mockImplementationOnce(() => Promise.reject(errnoError("EPERM")))
      .mockImplementationOnce(() => Promise.reject(errnoError("EPERM")))
      .mockImplementationOnce((from: string, to: string) => realRename(from, to));

    await atomicWriteAsync(target, "hello atomic");

    expect(await readFile(target, "utf-8")).toBe("hello atomic");
    expect(renameMock).toHaveBeenCalledTimes(3);
    expect(await tempFilesIn(dir)).toEqual([]);
  });

  it("throws a named AtomicWriteError naming the path and attempts when rename always fails with EBUSY", async () => {
    const target = path.join(dir, "locked.json");

    renameMock.mockImplementation(() => Promise.reject(errnoError("EBUSY")));

    const error = await atomicWriteAsync(target, "content").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtomicWriteError);
    const atomicError = error as AtomicWriteError;
    expect(atomicError.targetPath).toBe(target);
    expect(atomicError.attempts).toBeGreaterThan(1);
    expect(atomicError.message).toContain(target);
    expect(atomicError.message).toContain(String(atomicError.attempts));
    expect(atomicError.cause).toBeDefined();
    expect(await tempFilesIn(dir)).toEqual([]);
  });

  it("throws immediately after a single attempt on a non-retryable error (ENOSPC)", async () => {
    const target = path.join(dir, "full-disk.json");

    renameMock.mockImplementation(() => Promise.reject(errnoError("ENOSPC")));

    await expect(atomicWriteAsync(target, "content")).rejects.toThrow();

    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(await tempFilesIn(dir)).toEqual([]);
  });
});
