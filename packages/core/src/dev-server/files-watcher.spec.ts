import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * chokidar's native (non-fsevents) `raw` event hands back the watched
 * directory's path split from the changed entry's path relative to it — see
 * `createFsWatchInstance`/`handleEvent` in chokidar's `handler.js`, which
 * calls `emitRaw(rawEvent, evPath, { watchedPath })`. `evPath` is NOT the
 * absolute path the later `add`/`change` event carries. This fake mirrors
 * that shape so the spec can catch the mismatch that silently zeroed the
 * watcher-settle phase on Windows (where fsevents' full-path raw event
 * never masked the bug).
 */
class FakeChokidarWatcher {
  public handlers = new Map<string, (...args: any[]) => void>();

  public on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, handler);
    return this;
  }

  public close = vi.fn().mockResolvedValue(undefined);

  public emitRaw(evPath: string, watchedPath: string) {
    this.handlers.get("raw")?.("change", evPath, { watchedPath });
  }

  public emitChange(absolutePath: string) {
    this.handlers.get("change")?.(absolutePath);
  }
}

let fakeWatcher: FakeChokidarWatcher;

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => fakeWatcher),
  },
}));

vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    lazyGet: vi.fn().mockResolvedValue({ timings: true }),
  },
}));

const SRC_DIR = path.join(process.cwd(), "src");

vi.mock("../utils", () => ({
  rootPath: (...segments: string[]) => path.join(process.cwd(), ...segments),
  srcPath: () => SRC_DIR,
}));

import { FilesWatcher } from "./files-watcher";

describe("FilesWatcher — watcher-settle timing (devServer.timings on)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a real, non-zero settle duration between the raw fs event and the stabilised change", async () => {
    fakeWatcher = new FakeChokidarWatcher();
    const watcher = new FilesWatcher();
    await watcher.watch();

    const relativeToWatchedDir = "app.ts";
    const absolutePath = path.join(SRC_DIR, relativeToWatchedDir);

    let observedSettleMs: number | undefined;
    watcher.onFileChange((_filePath, settleMs) => {
      observedSettleMs = settleMs;
    });

    fakeWatcher.emitRaw(relativeToWatchedDir, SRC_DIR);

    // A real gap between the raw fs notification and chokidar's stabilised
    // `change` (its `awaitWriteFinish` window) — settleMs should reflect it.
    await new Promise((resolve) => setTimeout(resolve, 30));

    fakeWatcher.emitChange(absolutePath);

    expect(observedSettleMs).toBeDefined();
    expect(observedSettleMs).toBeGreaterThan(0);
  });
});
