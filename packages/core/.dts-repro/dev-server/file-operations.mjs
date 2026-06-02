import { Path } from "./path.mjs";
import { parseImports } from "./parse-imports.mjs";
import { DEV_SERVER_EVENTS } from "./events.mjs";
import { FileManager } from "./file-manager.mjs";
import { areSetsEqual } from "./utils.mjs";
import events from "@mongez/events";
//#region ../../@warlock.js/core/src/dev-server/file-operations.ts
/**
* FileOperations — add/update/delete lifecycle for a single file.
*
* Coordinates the dependency graph, manifest, and special-files collector
* so the orchestrator and event handler can stay declarative.
*/
var FileOperations = class {
	constructor(files, dependencyGraph, manifest, specialFilesCollector) {
		this.files = files;
		this.dependencyGraph = dependencyGraph;
		this.manifest = manifest;
		this.specialFilesCollector = specialFilesCollector;
	}
	/**
	* Register and process a new file. Recursively pulls in any
	* not-yet-tracked dependencies so the dep graph is complete.
	*/
	async addFile(relativePath) {
		const existing = this.files.get(relativePath);
		if (existing) return existing;
		const fileManager = new FileManager(Path.toAbsolute(relativePath), this.files, this);
		this.files.set(relativePath, fileManager);
		await fileManager.process();
		for (const depPath of fileManager.dependencies) if (!this.files.has(depPath)) try {
			await this.addFile(depPath);
		} catch {}
		for (const dependency of fileManager.dependencies) this.dependencyGraph.addDependency(relativePath, dependency);
		this.specialFilesCollector.addFile(fileManager);
		await this.reloadFilesWaitingForDependency(relativePath);
		return fileManager;
	}
	/**
	* Reprocess a file after a change. Re-syncs the dep graph and special-files
	* collector when its imports or path classification shift.
	*/
	async updateFile(relativePath) {
		const fileManager = this.files.get(relativePath);
		if (!fileManager) {
			await this.addFile(relativePath);
			return true;
		}
		const oldDependencies = new Set(fileManager.dependencies);
		try {
			if (!await fileManager.process()) return false;
			if (!areSetsEqual(oldDependencies, fileManager.dependencies)) this.dependencyGraph.updateFile(relativePath, fileManager.dependencies, fileManager.typeOnlyDependencies);
			this.specialFilesCollector.updateFile(fileManager);
			return true;
		} catch {
			return false;
		}
	}
	/**
	* Remove a file. Notifies dependents so they surface broken-import errors.
	*/
	async deleteFile(relativePath) {
		if (!this.files.get(relativePath)) return;
		const dependents = this.dependencyGraph.getDependents(relativePath);
		this.dependencyGraph.removeFile(relativePath);
		this.specialFilesCollector.removeFile(relativePath);
		this.manifest.removeFile(relativePath);
		for (const dependentPath of dependents) {
			const dependentFile = this.files.get(dependentPath);
			if (dependentFile) events.trigger(DEV_SERVER_EVENTS.FILE_READY, dependentFile);
		}
		setTimeout(() => this.files.delete(relativePath), 300);
	}
	/**
	* Re-process any file whose imports might now resolve to a freshly added
	* file. Covers "import A from './b'" where b.ts only just got created.
	*/
	async reloadFilesWaitingForDependency(newFilePath) {
		const dependents = [];
		for (const [existingPath, existingFile] of this.files) {
			if (existingPath === newFilePath) continue;
			if (existingFile.state !== "ready") continue;
			try {
				const importMap = await parseImports(existingFile.source, existingFile.absolutePath);
				for (const [, resolved] of importMap) if (resolved && Path.toRelative(resolved.absolutePath) === newFilePath) {
					dependents.push(existingPath);
					break;
				}
			} catch {
				continue;
			}
		}
		for (const dependentPath of dependents) {
			const dependentFile = this.files.get(dependentPath);
			if (!dependentFile) continue;
			try {
				await dependentFile.process({ force: true });
				this.dependencyGraph.updateFile(dependentPath, dependentFile.dependencies, dependentFile.typeOnlyDependencies);
			} catch {}
		}
	}
	updateFileDependents() {
		for (const [relativePath, fileManager] of this.files) fileManager.dependents = this.dependencyGraph.getDependents(relativePath);
	}
	syncFilesToManifest() {
		for (const [relativePath, fileManager] of this.files) this.manifest.setFile(relativePath, fileManager.toManifest());
	}
};
//#endregion
export { FileOperations };

//# sourceMappingURL=file-operations.mjs.map