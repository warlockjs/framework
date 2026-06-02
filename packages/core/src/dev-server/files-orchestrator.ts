import { colors } from "@mongez/copper";
import { init } from "es-module-lexer";
import type { MessagePort } from "node:worker_threads";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { DependencyGraph } from "./dependency-graph";
import { devLogDim, devLogSuccess } from "./dev-logger";
import { FileEventHandler } from "./file-event-handler";
import { FileManager } from "./file-manager";
import { FileOperations } from "./file-operations";
import { FilesWatcher } from "./files-watcher";
import { FILE_PROCESSING_BATCH_SIZE } from "./flags";
import { EslintHealthChecker } from "./health-checker/checkers/eslint-health-checker";
import { TypescriptHealthChecker } from "./health-checker/checkers/typescript-health-checker";
import { FileHealthCheckerContract } from "./health-checker/file-health-checker.contract";
import { FilesHealthcareManager } from "./health-checker/files-healthcare.manager";
import { buildTranspileInit } from "./loader/build-transpile-init.js";
import { registerLoader } from "./loader/register-loader.js";
import { ManifestManager } from "./manifest-manager";
import { ModuleLoader } from "./module-loader";
import { packageJsonManager } from "./package-json-manager";
import { Path } from "./path";
import { SpecialFilesCollector } from "./special-files-collector";
import { tsconfigManager } from "./tsconfig-manager";
import { ensureWarlockDirectory, getFilesFromDirectory } from "./utils";

/**
 * Register a cleanup callback that fires before the current module is
 * unloaded by HMR. Stack-inspects the caller so user code doesn't need to
 * thread the FileManager through.
 */
export function onCleanup(callback: () => any) {
  if (globalThis.__currentModuleFile) {
    globalThis.__currentModuleFile.addCleanup(callback);
    return;
  }

  const stack = new Error().stack;
  const callerLine = stack?.split("\n")[2];
  const match = callerLine?.match(/\((.+?):\d+:\d+\)/) || callerLine?.match(/at (.+?):\d+:\d+/);
  const callerFile = match?.[1];

  if (!callerFile) return;
  const fileManager = filesOrchestrator.files.get(Path.toRelative(callerFile));
  fileManager?.addCleanup(callback);
}

/**
 * Top-level coordinator for the dev server's file system.
 *
 * Owns: file discovery, the dependency graph, the manifest, the special-files
 * index, the file watcher, and the lifecycle of the ESM loader hook (which
 * provides cache-busting via `?v=N` version tokens).
 */
export class FilesOrchestrator {
  public readonly filesWatcher = new FilesWatcher();
  public readonly files = new Map<string, FileManager>();
  private readonly manifest = new ManifestManager(this.files);
  private readonly dependencyGraph = new DependencyGraph();
  private readonly healthCheckerManager = new FilesHealthcareManager(this.files);
  public readonly specialFilesCollector = new SpecialFilesCollector();
  public readonly moduleLoader = new ModuleLoader(this.specialFilesCollector);
  public readonly fileOperations: FileOperations;
  private readonly eventHandler: FileEventHandler;

  /** Main-thread end of the MessageChannel to the loader hook worker. */
  private loaderPort: MessagePort | null = null;

  /** Resolve callbacks for pending `flushVersionBumps()` calls. */
  private readonly pendingFlushes: Array<() => void> = [];

  public isInitialized = false;

  public constructor() {
    this.fileOperations = new FileOperations(
      this.files,
      this.dependencyGraph,
      this.manifest,
      this.specialFilesCollector,
    );

    this.eventHandler = new FileEventHandler(
      this.fileOperations,
      this.manifest,
      this.dependencyGraph,
      this.files,
    );
  }

  public async add(relativePath: string): Promise<FileManager> {
    return this.fileOperations.addFile(relativePath);
  }

  public async load<T>(relativePath: string, type = "other") {
    const fileManager = await this.add(relativePath);
    return this.moduleLoader.loadModule<T>(fileManager, fileManager.type || type);
  }

  public getDependencyGraph(): DependencyGraph {
    return this.dependencyGraph;
  }

  public getInvalidationChain(file: string): string[] {
    return this.dependencyGraph.getInvalidationChain(file);
  }

  public getFiles(): Map<string, FileManager> {
    return this.files;
  }

  public getHealthCheckerManager(): FilesHealthcareManager {
    return this.healthCheckerManager;
  }

  /**
   * Initialise managers and register the ESM loader hook. Must be called
   * before any user `src/` module is dynamically imported.
   */
  public async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    await init;
    await Promise.all([tsconfigManager.init(), packageJsonManager.init()]);

    // The loader hook writes itself into .warlock/, so ensure the dir exists.
    await ensureWarlockDirectory();

    const devServerConfig = await warlockConfigManager.lazyGet("devServer");
    const transpileInit = buildTranspileInit(
      tsconfigManager.tsconfig?.compilerOptions,
      devServerConfig?.transpileCacheDebug === true,
    );

    this.loaderPort = await registerLoader(transpileInit);

    this.loaderPort.on("message", (msg: { type: string }) => {
      if (msg.type === "sync-ack") {
        this.pendingFlushes.shift()?.();
      }
    });
  }

  /**
   * Tell the hook worker a file changed. The next `import()` of it will get
   * a fresh `?v=N` URL → Node cache miss → fresh content.
   */
  public bumpVersion(absolutePath: string): void {
    this.loaderPort?.postMessage({ type: "bump", absolutePath });
  }

  /**
   * Wait until the hook worker has processed every pending bump.
   *
   * `postMessage` is async — without this, a follow-up `import()` may
   * resolve before the worker increments the counter and Node will return
   * the cached old module.
   */
  public flushVersionBumps(): Promise<void> {
    if (!this.loaderPort) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this.pendingFlushes.push(resolve);
      this.loaderPort!.postMessage({ type: "sync" });
    });
  }

  /**
   * Discover files on disk, reconcile against the manifest, build the dep
   * graph, and persist the new manifest. Idempotent.
   */
  public async initializeAll() {
    const [filesInFilesystem, manifestExists] = await Promise.all([
      this.getAllFilesFromFilesystem(),
      this.manifest.init(),
    ]);

    if (!manifestExists) {
      await this.processFiles(filesInFilesystem);
    } else {
      await this.reconcileFiles(filesInFilesystem);
    }

    this.dependencyGraph.build(this.files);
    this.fileOperations.updateFileDependents();
    this.fileOperations.syncFilesToManifest();
    await this.manifest.save();
  }

  public async checkHealth(files: { added: string[]; changed: string[]; deleted: string[] }) {
    const filesToCheck = [...files.added, ...files.changed]
      .map((file) => this.files.get(Path.toRelative(file)))
      .filter((file): file is FileManager => !!file);

    const filesToDelete = files.deleted
      .map((file) => this.files.get(Path.toRelative(file)))
      .filter((file): file is FileManager => !!file);

    await this.healthCheckerManager.onFileChanges(filesToCheck);
    this.healthCheckerManager.removeFiles(filesToDelete);
    this.healthCheckerManager.checkFiles(filesToCheck);
  }

  public async startCheckingHealth(healthCheckers?: FileHealthCheckerContract[]): Promise<void> {
    devLogDim("Started File Health Checks in the background.");
    const checkers = healthCheckers ?? [new TypescriptHealthChecker(), new EslintHealthChecker()];
    await this.healthCheckerManager.setHealthCheckers(checkers).initialize();
    await this.healthCheckerManager.validateAllFiles();
  }

  /**
   * Glob the src directory, returning relative paths.
   */
  public async getAllFilesFromFilesystem(): Promise<string[]> {
    const absolutePaths = await getFilesFromDirectory();
    return absolutePaths.map((absPath) => Path.toRelative(absPath));
  }

  /**
   * Process every file from scratch — used when no manifest exists.
   */
  private async processFiles(filePaths: string[]) {
    devLogDim(`processing ${filePaths.length} files...`);
    await runInBatches(filePaths, FILE_PROCESSING_BATCH_SIZE, async (relativePath) => {
      const fileManager = new FileManager(
        Path.toAbsolute(relativePath),
        this.files,
        this.fileOperations,
      );
      this.files.set(relativePath, fileManager);
      await fileManager.process();
    });
    devLogSuccess(`processed ${filePaths.length} files`);
  }

  private async reconcileFiles(filesInFilesystem: string[]) {
    const filesInManifest = new Set(this.manifest.getAllFilePaths());
    const filesInFilesystemSet = new Set(filesInFilesystem);

    const newFiles = filesInFilesystem.filter((f) => !filesInManifest.has(f));
    const deletedFiles = Array.from(filesInManifest).filter((f) => !filesInFilesystemSet.has(f));
    const existingFiles = filesInFilesystem.filter((f) => filesInManifest.has(f));

    if (newFiles.length > 0 || deletedFiles.length > 0) {
      devLogDim(
        `reconciling: ${colors.green(newFiles.length)} new, ${colors.red(deletedFiles.length)} deleted, ${colors.blue(existingFiles.length)} existing`,
      );
    }

    await this.processFiles(newFiles);

    for (const relativePath of deletedFiles) {
      this.manifest.removeFile(relativePath);
      this.files.delete(relativePath);
    }

    await runInBatches(existingFiles, FILE_PROCESSING_BATCH_SIZE, async (relativePath) => {
      const fileManager = new FileManager(
        Path.toAbsolute(relativePath),
        this.files,
        this.fileOperations,
      );
      this.files.set(relativePath, fileManager);
      await fileManager.init(this.manifest.getFile(relativePath));
    });
  }

  public async watchFiles() {
    devLogSuccess("watching for file changes");

    this.filesWatcher.onFileChange((p) => this.eventHandler.handleFileChange(p));
    this.filesWatcher.onFileAdd((p) => this.eventHandler.handleFileAdd(p));
    this.filesWatcher.onFileDelete((p) => this.eventHandler.handleFileDelete(p));

    const watchConfig = warlockConfigManager.get("devServer")?.watch;
    await this.filesWatcher.watch(watchConfig);
  }
}

async function runInBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export const filesOrchestrator = new FilesOrchestrator();
