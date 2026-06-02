import { FileManifest, FileState, FileType } from "./types.mjs";
import { FileOperations } from "./file-operations.mjs";

//#region ../../@warlock.js/core/src/dev-server/file-manager.d.ts
type CleanupFunction = () => void;
/**
 * FileManager â€” per-file metadata for the dependency graph.
 *
 * The loader hook transpiles and caches on-demand at import time, so this
 * class never touches disk for anything beyond reading source to hash it
 * and parse its imports. Its job is keeping the metadata that the
 * orchestrator needs to invalidate dependents on change.
 */
declare class FileManager {
  readonly absolutePath: string;
  files: Map<string, FileManager>;
  fileOperations: FileOperations;
  relativePath: string;
  lastModified: number;
  hash: string;
  source: string;
  /** Files this file imports (relative paths). */
  dependencies: Set<string>;
  /**
   * Subset of `dependencies` reached only through type-only imports â€” a single
   * runtime occurrence makes the whole edge runtime.
   */
  typeOnlyDependencies: Set<string>;
  /** Original specifier â†’ resolved absolute path. */
  importMap: Map<string, string>;
  /** Files that import this file (relative paths). */
  dependents: Set<string>;
  type: FileType | undefined;
  /** Cleanup hooks the loaded module registered for itself. */
  cleanup: CleanupFunction[];
  /** Whether the source has zero runtime imports/exports. */
  isTypeOnlyFile: boolean;
  state: FileState;
  constructor(absolutePath: string, files: Map<string, FileManager>, fileOperations: FileOperations);
  addCleanup(cleanup: CleanupFunction | CleanupFunction[]): void;
  resetCleanup(): void;
  /**
   * Initial setup. Restores from manifest if the hash still matches,
   * otherwise re-processes from disk.
   */
  init(fileManifest?: Partial<FileManifest>): Promise<void>;
  /**
   * Read source, hash, parse imports, emit ready. The only file-system
   * touch happens here; transpilation is the loader hook's job.
   *
   * @param force - re-parse even when the hash matches.
   * @returns true if the file was (re)parsed.
   */
  process({
    force
  }?: {
    force?: boolean;
  }): Promise<boolean>;
  /**
   * Parse the current source and refresh `importMap`, `dependencies`, and
   * `typeOnlyDependencies`. A dependency is classified type-only iff every
   * import/export statement that resolves to it is type-only â€” a single
   * runtime reference makes the whole edge runtime.
   */
  protected rebuildImportMetadata(): Promise<void>;
  /**
   * Restore from a cached manifest entry. If the on-disk hash matches the
   * manifest hash, dep-graph metadata is restored from the manifest without
   * re-parsing. Otherwise the file is reprocessed.
   */
  protected initFromManifest(fileManifest: Partial<FileManifest>): Promise<void>;
  protected detectFileType(): void;
  toManifest(): FileManifest;
}
//#endregion
export { FileManager };
//# sourceMappingURL=file-manager.d.mts.map