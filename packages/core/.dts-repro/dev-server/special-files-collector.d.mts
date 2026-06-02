import { FileManager } from "./file-manager.mjs";

//#region ../../@warlock.js/core/src/dev-server/special-files-collector.d.ts
type SpecialFileType = "config" | "main" | "route" | "event" | "locale";
/**
 * Categorises files into the kinds the dev server treats specially
 * (config / main / route / event / locale) and exposes typed accessors.
 */
declare class SpecialFilesCollector {
  private readonly buckets;
  collect(files: Map<string, FileManager>): void;
  addFile(fileManager: FileManager): void;
  removeFile(relativePath: string): void;
  updateFile(fileManager: FileManager): void;
  getFileType(relativePath: string): SpecialFileType | null;
  getFilesByType(type: SpecialFileType): FileManager[];
  getStats(): Record<SpecialFileType, number>;
  clear(): void;
  private categorise;
}
//#endregion
export { SpecialFilesCollector };
//# sourceMappingURL=special-files-collector.d.mts.map