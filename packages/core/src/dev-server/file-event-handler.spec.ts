import events from "@mongez/events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEventHandler } from "./file-event-handler";

/**
 * The pre-work floor for a single-file edit is chokidar's `awaitWriteFinish`
 * (stabilityThreshold 100ms) plus this handler's own debounce. The debounce
 * used to add 150ms on top of that; it is now 50ms — the multi-file 500ms
 * Windows race-guard (a separate branch, hit only when 2+ code files land in
 * the same batch) is untouched.
 */
describe("FileEventHandler — debounces a single-file batch to 50ms", () => {
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

  it("does not flush a single change before 50ms have elapsed", async () => {
    const { handler, updateFile } = buildHandler();

    handler.handleFileChange("/abs/src/app/x.ts");
    await vi.advanceTimersByTimeAsync(49);

    expect(updateFile).not.toHaveBeenCalled();
  });

  it("flushes the single change once 50ms have elapsed", async () => {
    const { handler, updateFile } = buildHandler();
    const triggerSpy = vi.spyOn(events, "trigger");

    handler.handleFileChange("/abs/src/app/x.ts");
    await vi.advanceTimersByTimeAsync(50);

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      "dev-server:batch-complete",
      expect.objectContaining({ changed: expect.arrayContaining([expect.any(String)]) }),
    );
  });
});
