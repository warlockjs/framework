import { Path } from "./path.mjs";
import { devLogDim, devLogSuccess } from "./dev-logger.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { DependencyGraph } from "./dependency-graph.mjs";
import "./flags.mjs";
import { tsconfigManager } from "./tsconfig-manager.mjs";
import { FileEventHandler } from "./file-event-handler.mjs";
import { FileManager } from "./file-manager.mjs";
import { ensureWarlockDirectory, getFilesFromDirectory } from "./utils.mjs";
import { FileOperations } from "./file-operations.mjs";
import { FilesWatcher } from "./files-watcher.mjs";
import { EslintHealthChecker } from "./health-checker/checkers/eslint-health-checker.mjs";
import { TypescriptHealthChecker } from "./health-checker/checkers/typescript-health-checker.mjs";
import { FilesHealthcareManager } from "./health-checker/files-healthcare.manager.mjs";
import { buildTranspileInit } from "./loader/build-transpile-init.mjs";
import { registerLoader } from "./loader/register-loader.mjs";
import { ManifestManager } from "./manifest-manager.mjs";
import { ModuleLoader } from "./module-loader.mjs";
import { packageJsonManager } from "./package-json-manager.mjs";
import { SpecialFilesCollector } from "./special-files-collector.mjs";
import { colors } from "@mongez/copper";
import { init } from "es-module-lexer";
//#region ../../@warlock.js/core/src/dev-server/files-orchestrator.ts
/**
* Register a cleanup callback that fires before the current module is
* unloaded by HMR. Stack-inspects the caller so user code doesn't need to
* thread the FileManager through.
*/
function onCleanup(callback) {
	if (globalThis.__currentModuleFile) {
		globalThis.__currentModuleFile.addCleanup(callback);
		return;
	}
	const callerLine = (/* @__PURE__ */ new Error()).stack?.split("\n")[2];
	const callerFile = (callerLine?.match(/\((.+?):\d+:\d+\)/) || callerLine?.match(/at (.+?):\d+:\d+/))?.[1];
	if (!callerFile) return;
	filesOrchestrator.files.get(Path.toRelative(callerFile))?.addCleanup(callback);
}
/**
* Top-level coordinator for the dev server's file system.
*
* Owns: file discovery, the dependency graph, the manifest, the special-files
* index, the file watcher, and the lifecycle of the ESM loader hook (which
* provides cache-busting via `?v=N` version tokens).
*/
var FilesOrchestrator = class {
	constructor() {
		this.filesWatcher = new FilesWatcher();
		this.files = /* @__PURE__ */ new Map();
		this.manifest = new ManifestManager(this.files);
		this.dependencyGraph = new DependencyGraph();
		this.healthCheckerManager = new FilesHealthcareManager(this.files);
		this.specialFilesCollector = new SpecialFilesCollector();
		this.moduleLoader = new ModuleLoader(this.specialFilesCollector);
		this.loaderPort = null;
		this.pendingFlushes = [];
		this.isInitialized = false;
		this.fileOperations = new FileOperations(this.files, this.dependencyGraph, this.manifest, this.specialFilesCollector);
		this.eventHandler = new FileEventHandler(this.fileOperations, this.manifest, this.dependencyGraph, this.files);
	}
	async add(relativePath) {
		return this.fileOperations.addFile(relativePath);
	}
	async load(relativePath, type = "other") {
		const fileManager = await this.add(relativePath);
		return this.moduleLoader.loadModule(fileManager, fileManager.type || type);
	}
	getDependencyGraph() {
		return this.dependencyGraph;
	}
	getInvalidationChain(file) {
		return this.dependencyGraph.getInvalidationChain(file);
	}
	getFiles() {
		return this.files;
	}
	getHealthCheckerManager() {
		return this.healthCheckerManager;
	}
	/**
	* Initialise managers and register the ESM loader hook. Must be called
	* before any user `src/` module is dynamically imported.
	*/
	async init() {
		if (this.isInitialized) return;
		this.isInitialized = true;
		await init;
		await Promise.all([tsconfigManager.init(), packageJsonManager.init()]);
		await ensureWarlockDirectory();
		const devServerConfig = await warlockConfigManager.lazyGet("devServer");
		const transpileInit = buildTranspileInit(tsconfigManager.tsconfig?.compilerOptions, devServerConfig?.transpileCacheDebug === true);
		this.loaderPort = await registerLoader(transpileInit);
		this.loaderPort.on("message", (msg) => {
			if (msg.type === "sync-ack") this.pendingFlushes.shift()?.();
		});
	}
	/**
	* Tell the hook worker a file changed. The next `import()` of it will get
	* a fresh `?v=N` URL → Node cache miss → fresh content.
	*/
	bumpVersion(absolutePath) {
		this.loaderPort?.postMessage({
			type: "bump",
			absolutePath
		});
	}
	/**
	* Wait until the hook worker has processed every pending bump.
	*
	* `postMessage` is async — without this, a follow-up `import()` may
	* resolve before the worker increments the counter and Node will return
	* the cached old module.
	*/
	flushVersionBumps() {
		if (!this.loaderPort) return Promise.resolve();
		return new Promise((resolve) => {
			this.pendingFlushes.push(resolve);
			this.loaderPort.postMessage({ type: "sync" });
		});
	}
	/**
	* Discover files on disk, reconcile against the manifest, build the dep
	* graph, and persist the new manifest. Idempotent.
	*/
	async initializeAll() {
		const [filesInFilesystem, manifestExists] = await Promise.all([this.getAllFilesFromFilesystem(), this.manifest.init()]);
		if (!manifestExists) await this.processFiles(filesInFilesystem);
		else await this.reconcileFiles(filesInFilesystem);
		this.dependencyGraph.build(this.files);
		this.fileOperations.updateFileDependents();
		this.fileOperations.syncFilesToManifest();
		await this.manifest.save();
	}
	async checkHealth(files) {
		const filesToCheck = [...files.added, ...files.changed].map((file) => this.files.get(Path.toRelative(file))).filter((file) => !!file);
		const filesToDelete = files.deleted.map((file) => this.files.get(Path.toRelative(file))).filter((file) => !!file);
		await this.healthCheckerManager.onFileChanges(filesToCheck);
		this.healthCheckerManager.removeFiles(filesToDelete);
		this.healthCheckerManager.checkFiles(filesToCheck);
	}
	async startCheckingHealth(healthCheckers) {
		devLogDim("Started File Health Checks in the background.");
		const checkers = healthCheckers ?? [new TypescriptHealthChecker(), new EslintHealthChecker()];
		await this.healthCheckerManager.setHealthCheckers(checkers).initialize();
		await this.healthCheckerManager.validateAllFiles();
	}
	/**
	* Glob the src directory, returning relative paths.
	*/
	async getAllFilesFromFilesystem() {
		return (await getFilesFromDirectory()).map((absPath) => Path.toRelative(absPath));
	}
	/**
	* Process every file from scratch — used when no manifest exists.
	*/
	async processFiles(filePaths) {
		devLogDim(`processing ${filePaths.length} files...`);
		await runInBatches(filePaths, 500, async (relativePath) => {
			const fileManager = new FileManager(Path.toAbsolute(relativePath), this.files, this.fileOperations);
			this.files.set(relativePath, fileManager);
			await fileManager.process();
		});
		devLogSuccess(`processed ${filePaths.length} files`);
	}
	async reconcileFiles(filesInFilesystem) {
		const filesInManifest = new Set(this.manifest.getAllFilePaths());
		const filesInFilesystemSet = new Set(filesInFilesystem);
		const newFiles = filesInFilesystem.filter((f) => !filesInManifest.has(f));
		const deletedFiles = Array.from(filesInManifest).filter((f) => !filesInFilesystemSet.has(f));
		const existingFiles = filesInFilesystem.filter((f) => filesInManifest.has(f));
		if (newFiles.length > 0 || deletedFiles.length > 0) devLogDim(`reconciling: ${colors.green(newFiles.length)} new, ${colors.red(deletedFiles.length)} deleted, ${colors.blue(existingFiles.length)} existing`);
		await this.processFiles(newFiles);
		for (const relativePath of deletedFiles) {
			this.manifest.removeFile(relativePath);
			this.files.delete(relativePath);
		}
		await runInBatches(existingFiles, 500, async (relativePath) => {
			const fileManager = new FileManager(Path.toAbsolute(relativePath), this.files, this.fileOperations);
			this.files.set(relativePath, fileManager);
			await fileManager.init(this.manifest.getFile(relativePath));
		});
	}
	async watchFiles() {
		devLogSuccess("watching for file changes");
		this.filesWatcher.onFileChange((p) => this.eventHandler.handleFileChange(p));
		this.filesWatcher.onFileAdd((p) => this.eventHandler.handleFileAdd(p));
		this.filesWatcher.onFileDelete((p) => this.eventHandler.handleFileDelete(p));
		const watchConfig = warlockConfigManager.get("devServer")?.watch;
		await this.filesWatcher.watch(watchConfig);
	}
};
async function runInBatches(items, size, fn) {
	if (items.length === 0) return;
	for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
const filesOrchestrator = new FilesOrchestrator();
//#endregion
export { FilesOrchestrator, filesOrchestrator, onCleanup };

//# sourceMappingURL=files-orchestrator.mjs.map