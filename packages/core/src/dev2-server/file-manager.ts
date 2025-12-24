import events from "@mongez/events";
import { getFileAsync, lastModifiedAsync, putFileAsync } from "@mongez/fs";
import crypto from "crypto";
import { pathToFileURL } from "url";
import { DEV_SERVER_EVENTS } from "./events";
import { type FileOperations } from "./file-operations";
import { transformImports } from "./import-transformer";
import { parseImports } from "./parse-imports";
import { Path } from "./path";
import { transpileFile } from "./transpile-file";
import type { FileManifest, FileState, FileType, LayerType } from "./types";
import { warlockCachePath } from "./utils";

export class FileManager {
  /**
   * Relative path to root directory
   */
  public relativePath = "";
  /**
   * Last modified timestamp
   */
  public lastModified = 0;
  /**
   * Hash of the file content
   */
  public hash = "";
  /**
   * Source code of the file
   */
  public source = "";
  /**
   * Transpiled code of the file
   */
  public transpiled = "";
  /**
   * Dependencies of the file (relative paths)
   */
  public dependencies = new Set<string>();
  /**
   * Import map: original import path -> resolved absolute path
   * Used for import transformation
   */
  public importMap = new Map<string, string>();
  /**
   * Dependents of the file
   */
  public dependents = new Set<string>();
  /**
   * Version of the file
   */
  public version = 0;
  /**
   * Type of the file
   */
  public type: FileType | undefined;
  /**
   * Layer of the file
   */
  public layer: LayerType | undefined;
  /**
   * Cache path of the file
   */
  public cachePath = "";
  /**
   * File cleanup function
   */
  public cleanup?: () => void;

  /**
   * Whether imports have been transformed to cache paths
   */
  public importsTransformed = false;

  /**
   * Whether this file contains only type definitions (no runtime code)
   * Used to exclude from circular dependency detection
   */
  public isTypeOnlyFile = false;

  /**
   * File state
   */
  public state: FileState = "idle";

  /**
   * Constructor
   */
  public constructor(
    public readonly absolutePath: string,
    public files: Map<string, FileManager>,
    public fileOperations: FileOperations,
  ) {}

  /**
   * Initialize the file manager
   * @param fileManifest Optional manifest data from previous build
   * @param filesMap Optional map of all FileManager instances (for import transformation)
   */
  public async init(fileManifest?: Partial<FileManifest>) {
    this.state = "loading";

    // No manifest = fresh file, load from disk
    if (!fileManifest) {
      await this.loadFromDisk();
      // Import transformation will happen later in FilesOrchestrator.transformAllImports()
      // after all files are processed and available in the files map
      return;
    }

    // Manifest exists = check if file changed since last build
    await this.loadFromManifest(fileManifest);
    // Import transformation will happen later in FilesOrchestrator.transformAllImports()
    // for files that were reprocessed (importsTransformed = false)
  }

  /**
   * Get cached file path ready for dynamic import
   */
  public get cachePathUrl() {
    if (!this.cachePath) return "";

    return pathToFileURL(warlockCachePath(this.cachePath)).href;
  }

  /**
   * Load file with manifest data (check if changed)
   */
  protected async loadFromManifest(fileManifest: Partial<FileManifest>) {
    // Set basic properties from manifest
    this.relativePath = fileManifest.relativePath || Path.toRelative(this.absolutePath);
    this.version = fileManifest.version || 0;
    this.type = fileManifest.type;
    this.layer = fileManifest.layer;
    this.cachePath =
      fileManifest.cachePath || this.relativePath.replace(/\//g, "-").replace(/\.(ts|tsx)$/, ".js");

    // Check if file still exists
    try {
      this.source = await getFileAsync(this.absolutePath);
    } catch (error) {
      this.state = "deleted";
      return;
    }

    // Calculate current hash
    const currentHash = crypto.createHash("sha256").update(this.source).digest("hex");
    const currentLastModified = (await lastModifiedAsync(this.absolutePath)).getTime();

    // Compare with manifest data
    const hasChanged = currentHash !== fileManifest.hash;

    if (hasChanged) {
      // File changed - reprocess it
      this.hash = currentHash;
      this.lastModified = currentLastModified;
      this.version++;
      await this.processFile();
    } else {
      // File unchanged - load from cache
      this.hash = fileManifest.hash!;
      this.lastModified = fileManifest.lastModified!;
      this.dependencies = new Set(fileManifest.dependencies || []);
      this.dependents = new Set(fileManifest.dependents || []);

      // Load cached transpiled code
      try {
        this.transpiled = await getFileAsync(warlockCachePath(this.cachePath));
        // Cached files already have transformed imports
        this.importsTransformed = true;
      } catch (error) {
        // Cache missing - retranspile
        await this.processFile();
        // Will need import transformation
        this.importsTransformed = false;
      }
    }

    this.state = "ready";
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
  }

  /**
   * Load file from disk (fresh, no manifest)
   */
  protected async loadFromDisk() {
    this.source = await getFileAsync(this.absolutePath);
    this.hash = crypto.createHash("sha256").update(this.source).digest("hex");
    this.relativePath = Path.toRelative(this.absolutePath);
    this.lastModified = (await lastModifiedAsync(this.absolutePath)).getTime();
    this.version = 0;

    this.detectFileTypeAndLayer();

    // Generate cache path (replace / with - and change extension to .js)
    this.cachePath = this.relativePath.replace(/\//g, "-").replace(/\.(ts|tsx)$/, ".js");

    await this.processFile();

    this.state = "ready";
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
  }

  /**
   * Process file: parse imports first, then transpile
   */
  protected async processFile() {
    // STEP 1: Parse imports from source (must be first to get dependencies)
    const importMap = await parseImports(this.source, this.absolutePath);

    // Store dependencies as relative paths
    const importsRelativePaths = Array.from(importMap.values()).map((absPath) =>
      Path.toRelative(absPath),
    );

    this.dependencies = new Set(importsRelativePaths);

    // Store import map for later use in import transformation
    this.importMap = importMap;

    const missingImports = Array.from(this.dependencies.values()).filter(
      (relativePath) => !this.files.has(relativePath),
    );

    if (missingImports.length > 0) {
      // if missing, try to find them first in their locations
      await Promise.all(
        missingImports.map((relativePath) => this.fileOperations.addFile(relativePath)),
      );
    }

    // STEP 2: Transpile source code
    this.transpiled = await transpileFile(this);

    // STEP 3: Save transpiled code to cache
    await putFileAsync(warlockCachePath(this.cachePath), this.transpiled);
  }

  /**
   * Phase 1: Parse the file to discover dependencies
   * Does NOT write cache yet - used for batch file processing
   * to determine processing order
   */
  public async parseOnly(): Promise<void> {
    this.state = "loading";

    // Load source
    this.source = await getFileAsync(this.absolutePath);
    this.hash = crypto.createHash("sha256").update(this.source).digest("hex");
    this.relativePath = Path.toRelative(this.absolutePath);
    this.lastModified = (await lastModifiedAsync(this.absolutePath)).getTime();
    this.version = 0;

    // Detect type and layer
    this.detectFileTypeAndLayer();
    this.cachePath = this.relativePath.replace(/\//g, "-").replace(/\.(ts|tsx)$/, ".js");

    // Parse imports to discover dependencies
    const importMap = await parseImports(this.source, this.absolutePath);
    this.dependencies = new Set(
      Array.from(importMap.values()).map((absPath) => Path.toRelative(absPath)),
    );

    this.importMap = importMap;

    this.state = "parsed";
  }

  /**
   * Phase 2: Complete processing (transpile, transform, write cache)
   * Called after dependencies are ready
   */
  public async finalize(): Promise<void> {
    // Re-parse imports to ensure importMap is populated correctly
    // (During parseOnly(), some batch files may not have existed on disk yet)
    const importMap = await parseImports(this.source, this.absolutePath);
    this.dependencies = new Set(
      Array.from(importMap.values()).map((absPath) => Path.toRelative(absPath)),
    );

    this.importMap = importMap;

    // Check and add any missing dependencies first
    const missingImports = Array.from(this.dependencies.values()).filter(
      (relativePath) => !this.files.has(relativePath),
    );

    if (missingImports.length > 0) {
      await Promise.all(
        missingImports.map((relativePath) => this.fileOperations.addFile(relativePath)),
      );
    }

    // Transpile
    this.transpiled = await transpileFile(this);

    this.importsTransformed = false;

    // Transform imports to cache paths
    await this.transformImports();

    this.state = "ready";
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
  }

  /**
   * Detect file type and layer based on path
   */
  protected detectFileTypeAndLayer() {
    // Main entry files
    if (this.relativePath.includes("main.ts") || this.relativePath.includes("main.tsx")) {
      this.type = "main";
      this.layer = "HMR";
      return;
    }

    // Config files - FSR but handled specially (reload config + restart affected connectors)
    if (this.relativePath.startsWith("src/config/")) {
      this.type = "config";
      this.layer = "HMR";
      return;
    }

    // Routes files
    if (this.relativePath.endsWith("routes.ts") || this.relativePath.endsWith("routes.tsx")) {
      this.type = "route";
      this.layer = "HMR"; // For now FSR, will be HMR with wildcard routing
      return;
    }

    // Event files
    if (this.relativePath.includes("/events/")) {
      this.type = "event";
      this.layer = "HMR";
      return;
    }

    // Controllers
    if (this.relativePath.includes("controller")) {
      this.type = "controller";
      this.layer = "HMR";
      return;
    }

    // Services
    if (this.relativePath.includes("service")) {
      this.type = "service";
      this.layer = "HMR";
      return;
    }

    // Models
    if (this.relativePath.includes("model")) {
      this.type = "model";
      this.layer = "HMR";
      return;
    }

    // Default: other files use HMR
    this.type = "other";
    this.layer = "HMR";
  }

  /**
   * Update file when changed during development
   */
  public async update() {
    const newSource = await getFileAsync(this.absolutePath);

    // No change in content
    if (newSource.trim() === this.source.trim()) {
      return false;
    }

    this.state = "updating";
    this.source = newSource;
    this.version++;

    // Update hash and last modified
    this.hash = crypto.createHash("sha256").update(this.source).digest("hex");
    this.lastModified = (await lastModifiedAsync(this.absolutePath)).getTime();

    // Reprocess file
    await this.processFile();

    // Transform imports
    if (this.dependencies.size > 0) {
      this.importsTransformed = false;

      await this.transformImports();
    }

    this.state = "ready";
    return true;
  }

  /**
   * Force reprocess file even if source hasn't changed
   * Useful when dependencies become available (e.g., missing file is added back)
   */
  public async forceReprocess(): Promise<void> {
    this.state = "updating";
    this.version++;

    // Reprocess file (re-parse imports, retranspile, transform imports)
    await this.processFile();

    // Transform imports
    if (this.dependencies.size > 0) {
      this.importsTransformed = false;
      await this.transformImports();
    }

    this.state = "ready";
  }

  /**
   * Transform imports in transpiled code to use cache paths
   */
  public async transformImports() {
    if (this.importsTransformed) {
      return; // Already transformed
    }

    try {
      // Transform imports in transpiled code
      const transformedCode = transformImports(this, this.files);

      // Update the transpiled code
      this.transpiled = transformedCode;

      // Save the transformed code back to cache
      await putFileAsync(warlockCachePath(this.cachePath), transformedCode);

      // Mark as transformed
      this.importsTransformed = true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Export file data as manifest entry
   * Note: source and transpiled code are NOT stored in manifest
   * - Source code is in the original file
   * - Transpiled code is in .warlock/cache/
   * - Hash is used to detect changes
   */
  public toManifest(): FileManifest {
    return {
      absolutePath: this.absolutePath,
      relativePath: this.relativePath,
      lastModified: this.lastModified,
      hash: this.hash,
      dependencies: Array.from(this.dependencies),
      dependents: Array.from(this.dependents),
      version: this.version,
      type: this.type!,
      layer: this.layer!,
      cachePath: this.cachePath,
    };
  }
}
