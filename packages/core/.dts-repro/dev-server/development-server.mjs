import "../connectors/types.mjs";
import { devLogReady, devLogSection, devLogWarn, devServeLog } from "./dev-logger.mjs";
import { connectorsManager } from "../connectors/connectors-manager.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { MANIFEST_PATH } from "./flags.mjs";
import { filesOrchestrator } from "./files-orchestrator.mjs";
import "../warlock-config/index.mjs";
import { LayerExecutor } from "./layer-executor.mjs";
import { typeGenerator } from "./type-generator.mjs";
import { colors } from "@mongez/copper";
import events from "@mongez/events";
import { fileExistsAsync, getFileAsync, unlinkAsync } from "@warlock.js/fs";
//#region ../../@warlock.js/core/src/dev-server/development-server.ts
/**
* Top-level coordinator for `warlock dev`. Wires the file orchestrator, the
* connectors, and the layer executor together, and listens for the watcher's
* batched events to drive HMR.
*/
var DevelopmentServer = class {
	constructor(options = {}) {
		this.running = false;
		this.options = options;
		devLogSection("Starting Development Server...");
	}
	async start() {
		try {
			const startedAt = performance.now();
			if (this.options.fresh && await fileExistsAsync(MANIFEST_PATH)) {
				await unlinkAsync(MANIFEST_PATH);
				devServeLog(colors.cyanBright("Cleared manifest (--fresh)"));
			}
			await filesOrchestrator.init();
			await filesOrchestrator.initializeAll();
			await filesOrchestrator.watchFiles();
			filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.getFiles());
			this.setupEventListeners();
			await this.autoDiscoverFiles();
			await filesOrchestrator.moduleLoader.loadAll();
			await connectorsManager.startPhase("late");
			this.layerExecutor = new LayerExecutor(filesOrchestrator.getDependencyGraph(), filesOrchestrator.specialFilesCollector, filesOrchestrator.moduleLoader, (absolutePath) => filesOrchestrator.bumpVersion(absolutePath), () => filesOrchestrator.flushVersionBumps());
			this.running = true;
			const duration = performance.now() - startedAt;
			devLogReady(`Development Server is ready in ${colors.greenBright(parseDuration(duration))}`);
			const devServerConfig = await warlockConfigManager.get("devServer");
			const generateTypings = this.options.generateTypings ?? devServerConfig?.generateTypings ?? true;
			const healthCheckers = this.options.healthCheckers ?? devServerConfig?.healthCheckers ?? true;
			if (generateTypings) typeGenerator.executeGenerateAllCommand();
			if (healthCheckers) filesOrchestrator.startCheckingHealth(healthCheckers === true ? void 0 : healthCheckers);
		} catch (error) {
			devServeLog(colors.redBright(`Failed to start Development Server: ${error}`));
			await this.shutdown();
			throw error;
		}
	}
	/**
	* Eagerly import files whose decorators populate global registries so any
	* symbol-by-name resolution later in boot finds them.
	*/
	async autoDiscoverFiles() {
		const discoveryTypes = ["model"];
		for (const file of filesOrchestrator.files.values()) if (file.type && discoveryTypes.includes(file.type)) await filesOrchestrator.moduleLoader.loadModule(file, file.type);
	}
	setupEventListeners() {
		events.on("dev-server:batch-complete", (batch) => this.handleBatchComplete(batch));
	}
	async handleBatchComplete(batch) {
		if (!this.running || !this.layerExecutor) return;
		if (batch.changed.includes("warlock.config.ts")) devLogWarn("warlock.config.ts changed — restart the dev server to apply.");
		if (batch.changed.length > 0) batch.changed = await dropNoOpChanges(batch.changed);
		if (batch.added.length + batch.changed.length + batch.deleted.length === 0) return;
		const codeFiles = [...batch.added, ...batch.changed].filter((p) => !isEnvPath(p));
		try {
			await this.layerExecutor.executeBatchReload(codeFiles, filesOrchestrator.getFiles(), batch.deleted, batch.changed);
			typeGenerator.executeTypingsGenerator([...batch.added, ...batch.changed]);
			filesOrchestrator.checkHealth(batch);
		} catch (error) {
			devServeLog(colors.redBright(`Failed to execute batch reload: ${error}`));
		}
	}
	async shutdown() {
		if (!this.running) return;
		devServeLog(colors.redBright("Shutting down Development Server..."));
		this.running = false;
		await connectorsManager.shutdown();
		devServeLog(colors.greenBright("Development Server stopped"));
	}
	isRunning() {
		return this.running;
	}
};
async function dropNoOpChanges(changedPaths) {
	return (await Promise.all(changedPaths.map(async (relativePath) => {
		if (isEnvPath(relativePath)) return relativePath;
		const file = filesOrchestrator.files.get(relativePath);
		if (!file) return null;
		const content = await getFileAsync(file.absolutePath);
		if (content.trim() === file.source) return null;
		file.source = content;
		return relativePath;
	}))).filter((p) => p !== null);
}
function isEnvPath(path) {
	const basename = path.split("/").pop() ?? path;
	return basename === ".env" || basename.startsWith(".env.");
}
function parseDuration(ms) {
	if (ms < 1e3) return `${ms.toFixed(2)}ms`;
	if (ms > 6e4) return `${(ms / 6e4).toFixed(2)}m`;
	return `${(ms / 1e3).toFixed(2)}s`;
}
//#endregion
export { DevelopmentServer };

//# sourceMappingURL=development-server.mjs.map