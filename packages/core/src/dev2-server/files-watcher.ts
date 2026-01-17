import events from "@mongez/events";
import { Random } from "@mongez/reinforcements";
import chokidar from "chokidar";
import { rootPath, srcPath } from "../utils";
import { Path } from "./path";

type FileWatcherEvent = "change" | "delete" | "add" | "error" | "addDir" | "unlinkDir";

type FileChangeCallback = (filePath: string) => void;
type FileDeleteCallback = (filePath: string) => void;
type FileAddCallback = (filePath: string) => void;
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

export class FilesWatcher {
  /**
   * File watcher id
   */
  private id = Random.string();

  /**
   * Watch for files changes
   * @param config Optional watch configuration
   */
  public async watch(config?: WatchConfig) {
    // watch for .env file change and any changes in the src directory
    const paths = [rootPath(".env"), srcPath()].map((path) => Path.normalize(path));

    // Merge default exclude with config exclude
    const ignored = [...DEFAULT_EXCLUDE, ...(config?.exclude || [])];

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
    events.trigger(`file-watcher.${this.id}.${event}`, Path.normalize(filePath), error);
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
