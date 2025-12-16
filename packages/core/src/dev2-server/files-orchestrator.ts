import { colors } from "@mongez/copper";
import { putFileAsync, unlinkAsync } from "@mongez/fs";
import { init } from "es-module-lexer";
import { DependencyGraph } from "./dependency-graph";
import { devLogDim, devLogSuccess } from "./dev-logger";
import { FileEventHandler } from "./file-event-handler";
import { FileManager } from "./file-manager";
import { FileOperations } from "./file-operations";
import { FilesWatcher } from "./files-watcher";
import { FILE_PROCESSING_BATCH_SIZE } from "./flags";
import { HealthChecker } from "./health-checker";
import { transformImports } from "./import-transformer";
import { ManifestManager } from "./manifest-manager";
import { packageJsonManager } from "./package-json-manager";
import { Path } from "./path";
import type { SpecialFilesCollector } from "./special-files-collector";
import { tsconfigManager } from "./tsconfig-manager";
import { createFreshWarlockDirectory, getFilesFromDirectory, warlockCachePath } from "./utils";

export class FilesOrchestrator {
  private readonly files = new Map<string, FileManager>();
  private readonly manifest = new ManifestManager(this.files);
  private readonly dependencyGraph = new DependencyGraph();
  private readonly healthChecker = new HealthChecker();
  private readonly filesWatcher = new FilesWatcher();
  private readonly fileOperations: FileOperations;
  private readonly eventHandler: FileEventHandler;
  private readonly specialFilesCollector: SpecialFilesCollector;

  /**
   * Set the special files collector
   * This should be called before starting file watching
   */
  public constructor(collector: SpecialFilesCollector) {
    this.specialFilesCollector = collector;

    // Recreate file operations with the collector
    this.fileOperations = new FileOperations(
      this.files,
      this.dependencyGraph,
      this.manifest,
      collector,
    );

    // Recreate event handler with updated file operations
    this.eventHandler = new FileEventHandler(this.fileOperations, this.manifest);
  }

  /**
   * Get the dependency graph
   * Provides read-only access to the dependency graph for external use
   */
  public getDependencyGraph(): DependencyGraph {
    return this.dependencyGraph;
  }

  /**
   * Get invalidation chain for a file
   * Returns all files that need to be reloaded when the given file changes
   */
  public getInvalidationChain(file: string): string[] {
    return this.dependencyGraph.getInvalidationChain(file);
  }

  /**
   * Get all tracked files
   */
  public getFiles(): Map<string, FileManager> {
    return this.files;
  }

  /**
   * Initialize the files orchestrator
   */
  public async init() {
    // Initialize es-module-lexer (it's a promise, not a function)
    await init;

    // Initialize configuration managers
    await Promise.all([tsconfigManager.init(), packageJsonManager.init()]);

    // STEP 1: Parallel - Get filesystem state + Load manifest
    const [filesInFilesystem, manifestExists] = await Promise.all([
      this.getAllFilesFromFilesystem(),
      this.manifest.init(),
    ]);

    // STEP 2: Reconcile filesystem with manifest
    if (!manifestExists) {
      // No manifest = fresh start
      await this.processAllFilesFresh(filesInFilesystem);
    } else {
      // Manifest exists = reconcile differences
      await this.reconcileFiles(filesInFilesystem);
    }

    // STEP 3: Build dependency graph from all files
    this.dependencyGraph.build(this.files);

    // STEP 4: Update dependents in FileManager instances
    this.updateFileDependents();

    // STEP 5: Sync all files to manifest
    this.syncFilesToManifest();

    // STEP 6: Transform all imports to use cache paths
    await this.transformAllImports();

    // STEP 7: Save updated manifest
    await this.manifest.save();

    // STEP 8: Start file watcher
    await this.startFileWatcher();
  }

  /**
   * Get all TypeScript/JavaScript files from the filesystem
   * This always scans the actual filesystem, ignoring any cached data
   * @returns Array of relative file paths
   */
  private async getAllFilesFromFilesystem(): Promise<string[]> {
    const absolutePaths = await getFilesFromDirectory();
    // Convert to relative paths for consistency throughout the system
    return absolutePaths.map((absPath) => Path.toRelative(absPath));
  }

  /**
   * Process all files fresh (no manifest exists)
   * This happens on first run or when manifest is deleted
   * @param filePaths Array of relative file paths
   */
  private async processAllFilesFresh(filePaths: string[]) {
    devLogDim(`processing ${filePaths.length} files...`);

    // Ensure .warlock directory exists
    await createFreshWarlockDirectory();

    // Process files in batches for optimal performance
    const BATCH_SIZE = FILE_PROCESSING_BATCH_SIZE;

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (relativePath) => {
          // Convert to absolute path for FileManager
          const absolutePath = Path.toAbsolute(relativePath);
          const fileManager = new FileManager(absolutePath, this.files);
          // Store in map using relative path as key
          this.files.set(relativePath, fileManager);
          await fileManager.init(); // No manifest data
        }),
      );
    }

    devLogSuccess(`processed ${filePaths.length} files`);
  }

  /**
   * Reconcile filesystem state with manifest data
   * This handles: new files, deleted files, and changed files
   */
  private async reconcileFiles(filesInFilesystem: string[]) {
    const filesInManifest = new Set(this.manifest.getAllFilePaths());
    const filesInFilesystemSet = new Set(filesInFilesystem);

    // Find new files (in filesystem but not in manifest)
    const newFiles = filesInFilesystem.filter((file) => !filesInManifest.has(file));

    // Find deleted files (in manifest but not in filesystem)
    const deletedFiles = Array.from(filesInManifest).filter(
      (file) => !filesInFilesystemSet.has(file),
    );

    // Find existing files (in both)
    const existingFiles = filesInFilesystem.filter((file) => filesInManifest.has(file));

    if (newFiles.length > 0 || deletedFiles.length > 0) {
      const newText = newFiles.length > 0 ? colors.green(newFiles.length) : 0;
      const deletedText = deletedFiles.length > 0 ? colors.red(deletedFiles.length) : 0;
      const existingText = existingFiles.length > 0 ? colors.blue(existingFiles.length) : 0;
      devLogDim(`reconciling: ${newText} new, ${deletedText} deleted, ${existingText} existing`);
    }

    // Process new files
    await this.processNewFiles(newFiles);

    // Remove deleted files
    await this.processDeletedFiles(deletedFiles);

    // Process existing files (check for changes)
    await this.processExistingFiles(existingFiles);
  }

  /**
   * Process newly discovered files
   * @param filePaths Array of relative file paths
   */
  private async processNewFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;

    const BATCH_SIZE = FILE_PROCESSING_BATCH_SIZE;

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (relativePath) => {
          // Convert to absolute path for FileManager
          const absolutePath = Path.toAbsolute(relativePath);
          const fileManager = new FileManager(absolutePath, this.files);
          // Store in map using relative path as key
          this.files.set(relativePath, fileManager);
          await fileManager.init(); // No manifest data = process fresh
        }),
      );
    }
  }

  /**
   * Remove deleted files from tracking
   * @param filePaths Array of relative file paths
   */
  private async processDeletedFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;

    for (const relativePath of filePaths) {
      // Get file info from manifest before deletion
      const manifestEntry = this.manifest.getFile(relativePath);

      if (manifestEntry) {
        // Delete cache file
        try {
          await unlinkAsync(warlockCachePath(manifestEntry.cachePath));
        } catch (error) {
          // Cache file might not exist, ignore
        }
      }

      // Remove from manifest
      this.manifest.removeFile(relativePath);

      // Remove from files map
      this.files.delete(relativePath);
    }
  }

  /**
   * Process existing files (check if they changed since last run)
   * @param filePaths Array of relative file paths
   */
  private async processExistingFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;

    const BATCH_SIZE = FILE_PROCESSING_BATCH_SIZE;

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (relativePath) => {
          // Get manifest data using relative path
          const manifestData = this.manifest.getFile(relativePath);
          // Convert to absolute path for FileManager
          const absolutePath = Path.toAbsolute(relativePath);
          const fileManager = new FileManager(absolutePath, this.files);
          // Store in map using relative path as key
          this.files.set(relativePath, fileManager);

          // Pass manifest data to FileManager for comparison
          await fileManager.init(manifestData);
        }),
      );
    }
  }

  /**
   * Update dependents in all FileManager instances from dependency graph
   */
  private updateFileDependents() {
    for (const [relativePath, fileManager] of this.files) {
      const dependents = this.dependencyGraph.getDependents(relativePath);
      fileManager.dependents = dependents;
    }
  }

  /**
   * Sync all FileManager instances to manifest
   * Uses relative paths as keys for portability
   */
  private syncFilesToManifest() {
    for (const [relativePath, fileManager] of this.files) {
      this.manifest.setFile(relativePath, fileManager.toManifest());
    }
  }

  /**
   * Start file watcher to detect changes during development
   */
  private async startFileWatcher() {
    devLogSuccess("watching for file changes");

    // Connect file watcher to event handler
    this.filesWatcher.onFileChange((absolutePath) => {
      this.eventHandler.handleFileChange(absolutePath);
    });

    this.filesWatcher.onFileAdd((absolutePath) => {
      this.eventHandler.handleFileAdd(absolutePath);
    });

    this.filesWatcher.onFileDelete((absolutePath) => {
      this.eventHandler.handleFileDelete(absolutePath);
    });

    await this.filesWatcher.watch();
  }

  /**
   * Transform all imports to use cache paths
   * This is called AFTER all files are processed and transpiled
   * Only transforms files that haven't been transformed yet (freshly transpiled)
   */
  private async transformAllImports() {
    let transformedCount = 0;

    for (const [relativePath, fileManager] of this.files) {
      // Skip files that already have transformed imports (loaded from cache)
      if (fileManager.importsTransformed) {
        continue;
      }

      // Only transform files that have dependencies
      if (fileManager.dependencies.size === 0) {
        // Mark as transformed even if no dependencies
        fileManager.importsTransformed = true;
        continue;
      }

      try {
        // Transform imports in transpiled code
        const transformedCode = transformImports(fileManager, this.files);

        // Update the transpiled code
        fileManager.transpiled = transformedCode;

        // Save the transformed code back to cache
        await putFileAsync(warlockCachePath(fileManager.cachePath), transformedCode);

        // Mark as transformed
        fileManager.importsTransformed = true;

        transformedCount++;
      } catch (error) {}
    }
  }
}
