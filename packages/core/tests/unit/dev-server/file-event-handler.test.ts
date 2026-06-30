import events from "@mongez/events";
import { describe, expect, it, vi } from "vitest";
import { FileEventHandler } from "../../../src/dev-server/file-event-handler";

// Identity Path so the test controls the exact relative paths the handler sees
// (toRelative would otherwise strip the real project root).
vi.mock("../../../src/dev-server/path", () => ({
  Path: {
    toRelative: (path: string) => path,
    toAbsolute: (path: string) => path,
    normalize: (path: string) => path,
  },
}));

type Batch = { added: string[]; changed: string[]; deleted: string[] };

/**
 * A FileEventHandler wired to fakes. `updateFile` mirrors the real contract:
 * it returns true when the file genuinely changed (hash differs — e.g. when a
 * file is emptied) and false for a no-op save (identical content). Any path
 * containing "noop" simulates the no-op case.
 */
function makeHandler() {
  const fileOperations = {
    updateFile: vi.fn(async (relativePath: string) => !relativePath.includes("noop")),
    addFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    updateFileDependents: vi.fn(),
    syncFilesToManifest: vi.fn(),
  };
  const manifest = { save: vi.fn(async () => undefined) };

  const handler = new FileEventHandler(
    fileOperations as never,
    manifest as never,
    {} as never,
    new Map() as never,
  );

  return { handler, fileOperations };
}

function nextBatch(trigger: () => void): Promise<Batch> {
  return new Promise((resolve, reject) => {
    const subscription = events.subscribe("dev-server:batch-complete", (batch: Batch) => {
      (subscription as { unsubscribe?: () => void })?.unsubscribe?.();
      resolve(batch);
    });

    const timer = setTimeout(() => {
      (subscription as { unsubscribe?: () => void })?.unsubscribe?.();
      reject(new Error("dev-server:batch-complete was not emitted in time"));
    }, 5000);
    timer.unref?.();

    trigger();
  });
}

describe("FileEventHandler — no-op filtering (HMR fires when a file is emptied)", () => {
  it("emits a genuinely-changed file and drops a no-op save", async () => {
    const { handler, fileOperations } = makeHandler();

    const batch = await nextBatch(() => {
      // Emptying a file flips its hash, so updateFile reports a real change.
      handler.handleFileChange("src/emptied.ts");
      // A fsync-without-write reports no change.
      handler.handleFileChange("src/noop.ts");
    });

    expect(fileOperations.updateFile).toHaveBeenCalledWith("src/emptied.ts");
    expect(fileOperations.updateFile).toHaveBeenCalledWith("src/noop.ts");
    // Regression: the emptied file must survive into the reload batch.
    expect(batch.changed).toContain("src/emptied.ts");
    expect(batch.changed).not.toContain("src/noop.ts");
  });

  it("emits an empty changed list when the only save is a no-op", async () => {
    const { handler } = makeHandler();

    const batch = await nextBatch(() => {
      handler.handleFileChange("src/noop.ts");
    });

    expect(batch.changed).toEqual([]);
  });

  it("lets external paths (.env, warlock.config.ts) ride along without a hash check", async () => {
    const { handler, fileOperations } = makeHandler();

    const batch = await nextBatch(() => {
      handler.handleFileChange(".env");
      handler.handleFileChange("warlock.config.ts");
    });

    // External paths are not code files, so they are never hash-checked...
    expect(fileOperations.updateFile).not.toHaveBeenCalled();
    // ...but they still reach the dev server (config reload / restart warning).
    expect(batch.changed).toEqual(expect.arrayContaining([".env", "warlock.config.ts"]));
  });
});
