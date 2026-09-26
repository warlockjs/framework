import { afterEach, describe, expect, it, vi } from "vitest";
import { withConsoleOnStderr } from "./with-console-on-stderr";

describe("withConsoleOnStderr", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes console.log/info to console.error while the task runs, then restores them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const patchedLog = console.log;

    const result = await withConsoleOnStderr(async () => {
      console.log("processing 64 files...");
      console.info("processed 64 files");
      return 7;
    });

    expect(result).toBe(7);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("processing 64 files...");
    expect(error).toHaveBeenCalledWith("processed 64 files");
    expect(console.log).toBe(patchedLog);
  });

  it("restores console.log even when the task throws", async () => {
    const before = console.log;

    await expect(
      withConsoleOnStderr(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(console.log).toBe(before);
  });
});
