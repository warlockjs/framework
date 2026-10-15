import events from "@mongez/events";
import { Random } from "@mongez/reinforcements";
import chokidar from "chokidar";
import fg from "fast-glob";
import fs from "node:fs";
import nodePath from "node:path";
import { rootPath, srcPath } from "../utils";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { Path } from "../utils/normalized-path";

type FileWatcherEvent = "change" | "delete" | "add" | "error" | "addDir" | "unlinkDir";

type FileChangeCallback = (filePath: string, settleMs?: number) => void;
type FileDeleteCallback = (filePath: string, settleMs?: number) => void;
type FileAddCallback = (filePath: string, settleMs?: number) => void;
type FileErrorCallback = (filePath: string, error: Error) => void;
type FileAddDirCallback = (filePath: string) => void;
type FileUnlinkDirCallback = (filePath: string) => void;
type OnFileEventCallback =
  | FileChangeCallback
  | FileDeleteCallback
  | FileAddCallback
  | FileErrorCallback
  | FileAddDirCallback
  | FileUnlinkDirCallback;

/**
 * Watch configuration options
 */
export type WatchConfig = {
  /**
   * Glob patterns to include
   */
  include?: string[];
  /**
   * Glob patterns to exclude
   */
  exclude?: string[];
};

/**
 * Default patterns to exclude from watching
 */
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/.warlock/**", "**/.git/**"];

const GLOB_CHARS = /[*?{}[\]]/;

/**
 * Convert a glob (`**`, `*`, `?`, `{a,b}`) to a RegExp over a forward-slash
 * path. chokidar >= 4 has no glob support, so patterns are matched here
 * instead of being handed to it.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;

    if (char === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      braceDepth++;
      source += "(?:";
    } else if (char === "}" && braceDepth > 0) {
      braceDepth--;
      source += ")";
    } else if (char === "," && braceDepth > 0) {
      source += "|";
    } else {
      source += /[.+^$()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }

  return new RegExp(`^${source}$`);
}

/**
 * Build a chokidar `ignored` predicate from glob and literal patterns. A
 * pattern matches the absolute path or the project-relative path.
 */
export function createIgnoredMatcher(patterns: string[]): (path: string) => boolean {
  const matchers = patterns.map((pattern) => globToRegExp(Path.normalize(pattern)));

  return (path: string) => {
    const absolute = Path.normalize(path);
    const relative = Path.toRelative(absolute);

    return matchers.some((matcher) => matcher.test(absolute) || matcher.test(relative));
  };
}

/**
 * Expand glob `include` entries to concrete files (chokidar watches literal
 * paths only); literal entries pass through unchanged.
 */
function expandIncludes(include: string[]): string[] {
  return include.flatMap((entry) =>
    GLOB_CHARS.test(entry)
      ? fg.sync(entry.replace(/\\/g, "/"), { cwd: rootPath(), absolute: true })
      : [entry],
  );
}

/**
 * All .env file variants to watch
 */
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
];

export class FilesWatcher {
  /**
   * File watcher id
   */
  private id = Random.string();

  /**
   * First-seen timestamp per path from chokidar's `raw` event, which fires
   * BEFORE `awaitWriteFinish` stabilises the change. Diffing it against the
   * stabilised `add`/`change` timestamp gives the actual watcher-settle
   * duration for the phase-timing line. Only populated when
   * `devServer.timings` is on — see `watch()` — so a disabled flag costs
   * nothing here beyond the `undefined` checks below.
   */
  private readonly rawEventTimestamps = new Map<string, number>();

  /**
   * Watch for files changes
   * @param config Optional watch configuration
   */
  public async watch(config?: WatchConfig) {
    // Get user config from warlock.config.ts
    const devServerConfig = await warlockConfigManager.lazyGet("devServer");
    const userWatchConfig = devServerConfig?.watch;

    // Build paths to watch:
    // 1. All .env variants that exist
    // 2. warlock.config.ts (project-level settings; restart-required on change)
    // 3. src directory
    // 4. Any additional paths from user config
    // Also any other `.env*` at the root (`.env.shared`, `.env.staging`, …).
    const rootEnvFiles = fs
      .readdirSync(rootPath(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(".env"))
      .map((entry) => entry.name);
    const envPaths = [...new Set([...ENV_FILES, ".env.shared", ...rootEnvFiles])].map((file) =>
      rootPath(file),
    );
    const basePaths = [...envPaths, rootPath("warlock.config.ts"), srcPath()];
    const additionalPaths = expandIncludes(userWatchConfig?.include || config?.include || []);

    const paths = [...basePaths, ...additionalPaths].map((path) => Path.normalize(path));

    // Merge default exclude with config exclude
    const ignored = createIgnoredMatcher([
      ...DEFAULT_EXCLUDE,
      ...(userWatchConfig?.exclude || []),
      ...(config?.exclude || []),
    ]);

    const timingsEnabled = devServerConfig?.timings === true;

    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      ignored,
      persistent: true,
      usePolling: false, // Try native first, will fallback if needed
      interval: 100,
      binaryInterval: 300,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      // On Windows, explicitly enable recursive watching
      depth: 99,
    });

    if (timingsEnabled) {
      watcher.on("raw", (_event, evPath, details) => {
        // On the native (non-fsevents) handler chokidar uses on Windows/Linux,
        // `evPath` is only the changed entry's path *relative to the watched
        // directory* (see chokidar's `handler.js` `handleEvent`/`emitRaw`),
        // not the absolute path the later `add`/`change` event carries. Only
        // fsevents (macOS) hands back an already-absolute path. Reconstruct
        // the absolute path from `details.watchedPath` so the timestamp is
        // keyed the same way the stabilised event looks it up below —
        // otherwise the lookup always misses and the phase silently reads 0.
        const watchedPath = (details as { watchedPath?: string } | undefined)?.watchedPath;
        const absolutePath = watchedPath ? nodePath.resolve(watchedPath, evPath) : evPath;
        const normalized = Path.normalize(absolutePath);
        if (!this.rawEventTimestamps.has(normalized)) {
          this.rawEventTimestamps.set(normalized, performance.now());
        }
      });
    }

    watcher.on("add", (filePath) => this.triggerEvent("add", filePath));
    watcher.on("change", (filePath) => this.triggerEvent("change", filePath));
    watcher.on("unlink", (filePath) => this.triggerEvent("delete", filePath));
    watcher.on("addDir", (filePath) => this.triggerEvent("addDir", filePath));
    watcher.on("unlinkDir", (filePath) => this.triggerEvent("unlinkDir", filePath));
    // watcher.on("error", (error: Error, filePath: string) =>
    //   this.triggerEvent("error", filePath, error),
    // );

    // Cleanup on process exit
    process.on("SIGINT", async () => {
      await watcher.close();
    });
  }

  /**
   * Trigger event immediately (no debouncing here)
   * Debouncing is handled at the orchestrator level for batch processing
   */
  private triggerEvent(event: FileWatcherEvent, filePath: string, error?: Error) {
    const normalized = Path.normalize(filePath);
    const rawEventAt = this.rawEventTimestamps.get(normalized);
    let settleMs: number | undefined;

    if (rawEventAt !== undefined) {
      settleMs = performance.now() - rawEventAt;
      this.rawEventTimestamps.delete(normalized);
    }

    // `error` and `settleMs` share the same second-argument slot: an error
    // event's subscriber reads it as `Error`, every other event's subscriber
    // reads it as the watcher-settle duration (see the `On*Callback` types
    // above). Passing both positionally (`normalized, error, settleMs`) used
    // to leave `settleMs` in an unread third slot, so every change/add/delete
    // subscriber always received `undefined` in its `settleMs` parameter —
    // the watcher phase's timing was silently discarded here even when the
    // raw-event timestamp above resolved correctly.
    events.trigger(`file-watcher.${this.id}.${event}`, normalized, error ?? settleMs);
  }

  /**
   * On file change event
   */
  public onFileChange(callback: FileChangeCallback) {
    return this.on("change", callback);
  }

  /**
   * On file delete event
   */
  public onFileDelete(callback: FileDeleteCallback) {
    return this.on("delete", callback);
  }

  /**
   * On file add event
   */
  public onFileAdd(callback: FileAddCallback) {
    return this.on("add", callback);
  }

  /**
   * On file error event
   */
  public onFileError(callback: FileErrorCallback) {
    return this.on("error", callback);
  }

  /**
   * On file add dir event
   */
  public onDirectoryAdd(callback: FileAddDirCallback) {
    return this.on("addDir", callback);
  }

  /**
   * On file unlink dir event
   */
  public onDirectoryRemove(callback: FileUnlinkDirCallback) {
    return this.on("unlinkDir", callback);
  }

  /**
   * On file event
   */
  public on(event: FileWatcherEvent, callback: OnFileEventCallback) {
    return events.subscribe(`file-watcher.${this.id}.${event}`, callback);
  }
}
