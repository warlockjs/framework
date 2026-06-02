import { devLogHMR } from "./dev-logger.mjs";
import { connectorsManager } from "../connectors/connectors-manager.mjs";
import { configManager } from "../config/config-manager.mjs";
import { loadEnv } from "@mongez/dotenv";
//#region ../../@warlock.js/core/src/dev-server/layer-executor.ts
/**
* Decides what to reload when a batch of files changes.
*
* Strategy: bump the hook's version counter for every file in the
* invalidation chain, wait for the hook worker to flush, then re-import
* any special files (config / main / routes / events / locales) the chain
* touched and restart any connector whose watched-files overlap the change.
*/
var LayerExecutor = class {
	constructor(dependencyGraph, specialFilesCollector, moduleLoader, bumpVersion, flushVersionBumps) {
		this.dependencyGraph = dependencyGraph;
		this.specialFilesCollector = specialFilesCollector;
		this.moduleLoader = moduleLoader;
		this.bumpVersion = bumpVersion;
		this.flushVersionBumps = flushVersionBumps;
	}
	/**
	* Entry point for the file watcher batch.
	*
	* @param changedPaths - code files added or changed in this batch
	* @param filesMap - all tracked files (relativePath → FileManager)
	* @param deletedFiles - paths that were removed from disk
	* @param allChangedPaths - includes .env so we can detect config reloads
	*/
	async executeBatchReload(changedPaths, filesMap, deletedFiles, allChangedPaths) {
		const envFilesChanged = (allChangedPaths ?? []).some(isEnvPath);
		if (changedPaths.length === 0 && deletedFiles.length === 0 && !envFilesChanged) return;
		for (const path of deletedFiles) {
			const file = filesMap.get(path);
			if (file) this.moduleLoader.cleanupDeletedModule(file);
		}
		if (changedPaths.length === 0 && envFilesChanged) {
			const configPaths = await this.reloadAffectedModules([".env"], filesMap);
			await this.restartAffectedConnectors(configPaths);
			return;
		}
		if (changedPaths.length === 0) return;
		const invalidationChain = /* @__PURE__ */ new Set();
		for (const path of changedPaths) {
			for (const file of this.dependencyGraph.getInvalidationChain(path)) invalidationChain.add(file);
			devLogHMR(path, invalidationChain.size - 1);
		}
		const chain = Array.from(invalidationChain);
		for (const relativePath of chain) {
			const file = filesMap.get(relativePath);
			if (!file) continue;
			this.moduleLoader.runCleanup(file);
			this.bumpVersion(file.absolutePath);
			await file.process({ force: true });
		}
		await this.flushVersionBumps();
		const affectedConfigPaths = await this.reloadAffectedModules(chain, filesMap);
		await this.restartAffectedConnectors([...changedPaths, ...affectedConfigPaths]);
	}
	async restartAffectedConnectors(affectedFiles) {
		const toRestart = connectorsManager.list().filter((connector) => connector.shouldRestart(affectedFiles));
		for (const connector of toRestart) await connector.restart();
	}
	/**
	* Re-import every special file whose path or dependency-set intersects the
	* invalidation chain. Returns the relative paths of any config files that
	* reloaded so the caller can pass them to the connector-restart pass.
	*/
	async reloadAffectedModules(chain, filesMap) {
		const isEnvAffected = chain.some(isEnvPath);
		if (isEnvAffected) await loadEnv();
		const isAffected = (file) => isFileAffected(file, chain);
		const affectedModels = chain.map((path) => filesMap.get(path)).filter((file) => !!file && file.type === "model");
		for (const file of affectedModels) await this.moduleLoader.loadModule(file, "model");
		const collector = this.specialFilesCollector;
		const affectedConfigs = collector.getFilesByType("config").filter((file) => isEnvAffected ? true : isAffected(file));
		const affectedMains = collector.getFilesByType("main").filter(isAffected);
		const affectedRoutes = collector.getFilesByType("route").filter(isAffected);
		const affectedEvents = collector.getFilesByType("event").filter(isAffected);
		const affectedLocales = collector.getFilesByType("locale").filter(isAffected);
		if (!(affectedConfigs.length > 0 || affectedMains.length > 0 || affectedRoutes.length > 0 || affectedEvents.length > 0 || affectedLocales.length > 0)) {
			const tail = filesMap.get(chain[chain.length - 1]);
			if (tail) await this.moduleLoader.reloadModule(tail);
			return [];
		}
		const configPaths = [];
		for (const file of affectedConfigs) {
			await configManager.reload(file);
			configPaths.push(file.relativePath);
		}
		for (const file of affectedLocales) await this.moduleLoader.reloadModule(file);
		for (const file of affectedMains) await this.moduleLoader.reloadModule(file);
		for (const file of affectedEvents) await this.moduleLoader.reloadModule(file);
		for (const file of affectedRoutes) await this.moduleLoader.reloadModule(file);
		return configPaths;
	}
};
function isEnvPath(path) {
	const basename = path.split("/").pop() ?? path;
	return basename === ".env" || basename.startsWith(".env.");
}
/**
* A file is "affected" if it itself is in the chain or imports something in it.
*/
function isFileAffected(file, chain) {
	if (chain.includes(file.relativePath)) return true;
	for (const dep of file.dependencies) if (chain.includes(dep)) return true;
	return false;
}
//#endregion
export { LayerExecutor };

//# sourceMappingURL=layer-executor.mjs.map