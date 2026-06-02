import { FileManifest } from "./types.mjs";
import { FileManager } from "./file-manager.mjs";

//#region ../../@warlock.js/core/src/dev-server/manifest-manager.d.ts
declare class ManifestManager {
  private readonly files;
  /**
   * Manifest data with metadata
   */
  private manifest;
  /**
   * Constructor
   */
  constructor(files: Map<string, FileManager>);
  /**
   * Initialize manifest manager
   * @returns true if manifest exists, false otherwise
   */
  init(): Promise<boolean>;
  /**
   * Save manifest to disk
   */
  save(): Promise<void>;
  /**
   * Get file manifest data
   */
  getFile(filePath: string): FileManifest | undefined;
  /**
   * Check if file exists in manifest
   */
  hasFile(filePath: string): boolean;
  /**
   * Set file manifest data
   */
  setFile(filePath: string, fileManifest: FileManifest): void;
  /**
   * Remove file from manifest
   */
  removeFile(filePath: string): void;
  /**
   * Get all file paths in manifest
   */
  getAllFilePaths(): string[];
  /**
   * Get all file manifests
   */
  getAllFiles(): Record<string, FileManifest>;
  /**
   * Get manifest metadata
   */
  getMetadata(): {
    version: string;
    lastBuildTime: number;
    projectHash: string | undefined;
    stats: {
      totalFiles: number;
      totalDependencies: number;
    };
  };
  /**
   * Calculate total dependencies across all files
   */
  private calculateTotalDependencies;
  /**
   * Clear all files from manifest
   */
  clear(): void;
}
//#endregion
export { ManifestManager };
//# sourceMappingURL=manifest-manager.d.mts.map