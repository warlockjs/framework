//#region ../../@warlock.js/core/src/dev-server/files-watcher.d.ts
type FileWatcherEvent = "change" | "delete" | "add" | "error" | "addDir" | "unlinkDir";
type FileChangeCallback = (filePath: string) => void;
type FileDeleteCallback = (filePath: string) => void;
type FileAddCallback = (filePath: string) => void;
type FileErrorCallback = (filePath: string, error: Error) => void;
type FileAddDirCallback = (filePath: string) => void;
type FileUnlinkDirCallback = (filePath: string) => void;
type OnFileEventCallback = FileChangeCallback | FileDeleteCallback | FileAddCallback | FileErrorCallback | FileAddDirCallback | FileUnlinkDirCallback;
/**
 * Watch configuration options
 */
type WatchConfig = {
  /**
   * Glob patterns to include
   */
  include?: string[];
  /**
   * Glob patterns to exclude
   */
  exclude?: string[];
};
declare class FilesWatcher {
  /**
   * File watcher id
   */
  private id;
  /**
   * Watch for files changes
   * @param config Optional watch configuration
   */
  watch(config?: WatchConfig): Promise<void>;
  /**
   * Trigger event immediately (no debouncing here)
   * Debouncing is handled at the orchestrator level for batch processing
   */
  private triggerEvent;
  /**
   * On file change event
   */
  onFileChange(callback: FileChangeCallback): import("@mongez/events").EventSubscription;
  /**
   * On file delete event
   */
  onFileDelete(callback: FileDeleteCallback): import("@mongez/events").EventSubscription;
  /**
   * On file add event
   */
  onFileAdd(callback: FileAddCallback): import("@mongez/events").EventSubscription;
  /**
   * On file error event
   */
  onFileError(callback: FileErrorCallback): import("@mongez/events").EventSubscription;
  /**
   * On file add dir event
   */
  onDirectoryAdd(callback: FileAddDirCallback): import("@mongez/events").EventSubscription;
  /**
   * On file unlink dir event
   */
  onDirectoryRemove(callback: FileUnlinkDirCallback): import("@mongez/events").EventSubscription;
  /**
   * On file event
   */
  on(event: FileWatcherEvent, callback: OnFileEventCallback): import("@mongez/events").EventSubscription;
}
//#endregion
export { FilesWatcher };
//# sourceMappingURL=files-watcher.d.mts.map