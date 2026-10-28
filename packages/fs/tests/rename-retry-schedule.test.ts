import { describe, expect, it, vi } from "vitest";
import { AtomicWriteError } from "../src/atomic-write-error";

const renameMock = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  rename: (...args: unknown[]) => renameMock(...args),
}));

const { renameRetryDelays, renameWithRetry } = await import("../src/retry-rename");

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("rename retry schedule", () => {
  it("doubles from the initial delay and caps each wait", () => {
    expect(renameRetryDelays(8, 10, 100)).toEqual([10, 20, 40, 80, 100, 100, 100]);
  });

  it("waits a few seconds in total with the Windows-style schedule", () => {
    const total = renameRetryDelays(30, 10, 150).reduce((sum, ms) => sum + ms, 0);

    expect(total).toBeGreaterThan(2_000);
    expect(total).toBeLessThan(5_000);
  });

  it("keeps retrying a sharing violation until the lock clears", async () => {
    renameMock.mockReset();
    renameMock
      .mockRejectedValueOnce(errno("EPERM"))
      .mockRejectedValueOnce(errno("EBUSY"))
      .mockRejectedValueOnce(errno("EACCES"))
      .mockResolvedValueOnce(undefined);

    await renameWithRetry("a", "b", { attempts: 10, initialDelayMs: 1, maxDelayMs: 2 });

    expect(renameMock).toHaveBeenCalledTimes(4);
  });

  it("throws AtomicWriteError once the attempts are used up", async () => {
    renameMock.mockReset();
    renameMock.mockRejectedValue(errno("EPERM"));

    await expect(
      renameWithRetry("a", "b", { attempts: 4, initialDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBeInstanceOf(AtomicWriteError);
    expect(renameMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-transient error", async () => {
    renameMock.mockReset();
    renameMock.mockRejectedValue(errno("ENOSPC"));

    await expect(renameWithRetry("a", "b")).rejects.toThrow("ENOSPC");
    expect(renameMock).toHaveBeenCalledTimes(1);
  });
});
