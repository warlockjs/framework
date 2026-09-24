import events from "@mongez/events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEventHandler } from "./file-event-handler";

/** Build an absolute path under the current cwd so `Path.toRelative` resolves
 * it back to `relativePath` predictably across platforms. */
function absolute(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

/**
 * The pre-work floor for a single-file edit is chokidar's `awaitWriteFinish`
 * (stabilityThreshold 100ms) plus this handler's own debounce. The debounce
 * used to add 150ms on top of that; it is now 12ms for isolated saves — the multi-file 500ms
 * Windows race-guard (a separate branch, hit only when 2+ code files land in
 * the same batch) is untouched.
 */
describe("FileEventHandler — adaptively debounces file-event batches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildHandler() {
    const updateFile = vi.fn().mockResolvedValue(true);
    const fileOperations = {
      updateFile,
      addFile: vi.fn(),
      updateFileDependents: vi.fn(),
      syncFilesToManifest: vi.fn(),
    };
    const manifest = { save: vi.fn().mockResolvedValue(undefined) };
    const dependencyGraph = {};
    const files = new Map();

    const handler = new FileEventHandler(
      fileOperations as never,
      manifest as never,
      dependencyGraph as never,
      files as never,
    );

    return { handler, updateFile };
  }

  it("does not flush a single change before the 12ms quiet window has elapsed", async () => {
    const { handler, updateFile } = buildHandler();

    handler.handleFileChange("/abs/src/app/x.ts");
    await vi.advanceTimersByTimeAsync(11);

    expect(updateFile).not.toHaveBeenCalled();
  });

  it("flushes a single change once the 12ms quiet window has elapsed", async () => {
    const { handler, updateFile } = buildHandler();
    const triggerSpy = vi.spyOn(events, "trigger");

    handler.handleFileChange("/abs/src/app/x.ts");
    await vi.advanceTimersByTimeAsync(12);

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      "dev-server:batch-complete",
      expect.objectContaining({ changed: expect.arrayContaining([expect.any(String)]) }),
    );
  });

  it("coalesces a burst into one reload containing every changed file", async () => {
    const { handler, updateFile } = buildHandler();
    const triggerSpy = vi.spyOn(events, "trigger");

    handler.handleFileChange(absolute("src/app/one.ts"));
    await vi.advanceTimersByTimeAsync(5);
    handler.handleFileChange(absolute("src/app/two.ts"));
    await vi.advanceTimersByTimeAsync(5);
    handler.handleFileChange(absolute("src/app/three.ts"));
    await vi.advanceTimersByTimeAsync(12);
    await vi.advanceTimersByTimeAsync(500);

    expect(updateFile).toHaveBeenCalledTimes(3);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      "dev-server:batch-complete",
      expect.objectContaining({
        changed: ["src/app/one.ts", "src/app/two.ts", "src/app/three.ts"],
      }),
    );
  });

  it("flushes continuous events at the 60ms max-wait cap", async () => {
    const { handler, updateFile } = buildHandler();

    handler.handleFileChange(absolute("src/app/zero.ts"));

    for (let eventIndex = 1; eventIndex < 6; eventIndex++) {
      await vi.advanceTimersByTimeAsync(10);
      handler.handleFileChange(absolute(`src/app/${eventIndex}.ts`));
    }

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(500);

    expect(updateFile).toHaveBeenCalledTimes(6);
  });
});

/**
 * A rename/move can fire an `add` event for a path that no longer exists by
 * the time it is read/stat'd — the file already moved to its destination.
 * `FileManager.process()` now reports that as `state: "deleted"` instead of
 * throwing, and the handler must fold it into the batch as a removal rather
 * than printing a false failure. A genuine failure (permissions, etc.) must
 * still be printed.
 */
describe("FileEventHandler — ENOENT during an add is treated as a removal, not a failure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildHandler(addFileImpl: (path: string) => Promise<{ state: string }>) {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const fileOperations = {
      updateFile: vi.fn().mockResolvedValue(false),
      addFile: vi.fn(addFileImpl),
      deleteFile,
      updateFileDependents: vi.fn(),
      syncFilesToManifest: vi.fn(),
    };
    const manifest = { save: vi.fn().mockResolvedValue(undefined) };
    const dependencyGraph = {};
    const files = new Map();

    const handler = new FileEventHandler(
      fileOperations as never,
      manifest as never,
      dependencyGraph as never,
      files as never,
    );

    return { handler, fileOperations, deleteFile };
  }

  it("(a) logs no error and reports the path as deleted, not added, when the add target no longer exists", async () => {
    const { handler, deleteFile } = buildHandler(async () => ({ state: "deleted" }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const triggerSpy = vi.spyOn(events, "trigger");

    handler.handleFileAdd(absolute("src/app/welcome.page.tsx"));
    await vi.advanceTimersByTimeAsync(12);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith("src/app/welcome.page.tsx");
    expect(triggerSpy).toHaveBeenCalledWith(
      "dev-server:batch-complete",
      expect.objectContaining({
        added: [],
        deleted: expect.arrayContaining(["src/app/welcome.page.tsx"]),
      }),
    );
  });

  it("(b) a rename's stale old-path add ENOENTs silently while the new path is added normally", async () => {
    const { handler, deleteFile } = buildHandler(async (path: string) =>
      path.includes("welcome.page.tsx") ? { state: "deleted" } : { state: "ready" },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const triggerSpy = vi.spyOn(events, "trigger");

    handler.handleFileAdd(absolute("src/app/welcome.page.tsx"));
    handler.handleFileAdd(absolute("src/app/welcome-home.page.tsx"));
    handler.handleFileDelete(absolute("src/app/welcome.page.tsx"));
    await vi.advanceTimersByTimeAsync(560);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith("src/app/welcome.page.tsx");
    expect(triggerSpy).toHaveBeenCalledWith(
      "dev-server:batch-complete",
      expect.objectContaining({
        added: ["src/app/welcome-home.page.tsx"],
      }),
    );
  });

  it("(c) a genuine failure (e.g. EACCES) during an add is still logged", async () => {
    const permissionError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const { handler } = buildHandler(async () => {
      throw permissionError;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    handler.handleFileAdd(absolute("src/app/locked.page.tsx"));
    await vi.advanceTimersByTimeAsync(12);

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to add file src/app/locked.page.tsx:",
      permissionError,
    );
  });
});

describe("FileEventHandler — batches are serialized (C2:B11)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start batch B while batch A is still in flight", async () => {
    let releaseFirst!: () => void;
    const updateFile = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (releaseFirst = () => resolve(true))))
      .mockResolvedValue(true);

    const handler = new FileEventHandler(
      { updateFile, addFile: vi.fn(), updateFileDependents: vi.fn(), syncFilesToManifest: vi.fn() } as never,
      { save: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      new Map() as never,
    );

    handler.handleFileChange(absolute("src/app/a.ts"));
    await vi.advanceTimersByTimeAsync(12);
    expect(updateFile).toHaveBeenCalledTimes(1);

    handler.handleFileChange(absolute("src/app/b.ts"));
    await vi.advanceTimersByTimeAsync(50);
    expect(updateFile).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(50);
    expect(updateFile).toHaveBeenCalledTimes(2);
  });
});

describe("FileEventHandler — non-code include files", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports a changed .sql include as a restart trigger, outside the module graph", async () => {
    const updateFile = vi.fn().mockResolvedValue(true);
    const handler = new FileEventHandler(
      { updateFile, addFile: vi.fn(), updateFileDependents: vi.fn(), syncFilesToManifest: vi.fn() } as never,
      { save: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      new Map() as never,
    );
    handler.setIncludeMatcher((p) => p.startsWith("fixtures/"));

    const batches: Array<{ changed: string[]; restartTriggers: string[] }> = [];
    const listener = (batch: never) => batches.push(batch);
    const subscription = events.on("dev-server:batch-complete", listener);

    handler.handleFileChange(path.join(process.cwd(), "fixtures/seed.sql"));
    await vi.advanceTimersByTimeAsync(50);

    subscription.unsubscribe();

    expect(updateFile).not.toHaveBeenCalled();
    expect(batches[0]?.restartTriggers).toEqual(["fixtures/seed.sql"]);
  });
});
