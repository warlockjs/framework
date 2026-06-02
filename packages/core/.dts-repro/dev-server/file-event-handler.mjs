import { Path } from "./path.mjs";
import { devLogSuccess } from "./dev-logger.mjs";
import "./flags.mjs";
import { clearFileExistsCache } from "./parse-imports.mjs";
import { debounce } from "@mongez/reinforcements";
import events from "@mongez/events";
//#region ../../@warlock.js/core/src/dev-server/file-event-handler.ts
/**
* Receives raw watcher events and processes them in a single debounced batch.
* Order within a batch: adds → changes → deletes, so changes can reference
* newly-added files and deletes fire last.
*/
var FileEventHandler = class {
	constructor(fileOperations, manifest, dependencyGraph, files) {
		this.fileOperations = fileOperations;
		this.manifest = manifest;
		this.dependencyGraph = dependencyGraph;
		this.files = files;
		this.pendingChanges = /* @__PURE__ */ new Set();
		this.pendingAdds = /* @__PURE__ */ new Set();
		this.pendingDeletes = /* @__PURE__ */ new Set();
		this.processPendingEvents = debounce(() => this.processBatch(), 150);
	}
	handleFileChange(absolutePath) {
		this.pendingChanges.add(Path.toRelative(absolutePath));
		this.processPendingEvents();
	}
	handleFileAdd(absolutePath) {
		this.pendingAdds.add(Path.toRelative(absolutePath));
		this.processPendingEvents();
	}
	handleFileDelete(absolutePath) {
		this.pendingDeletes.add(Path.toRelative(absolutePath));
		this.processPendingEvents();
	}
	async processBatch() {
		const changes = Array.from(this.pendingChanges);
		const adds = Array.from(this.pendingAdds);
		const deletes = Array.from(this.pendingDeletes);
		this.pendingChanges.clear();
		this.pendingAdds.clear();
		this.pendingDeletes.clear();
		if (changes.length === 0 && adds.length === 0 && deletes.length === 0) return;
		const codeChanges = changes.filter((p) => !isExternalPath(p));
		const codeAdds = adds.filter((p) => !isExternalPath(p));
		if (codeAdds.length + codeChanges.length > 1) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			clearFileExistsCache();
		}
		await this.processBatchAdds(codeAdds);
		await this.processBatchChanges(codeChanges);
		await this.processBatchDeletes(deletes);
		this.fileOperations.updateFileDependents();
		this.fileOperations.syncFilesToManifest();
		await this.manifest.save();
		events.trigger("dev-server:batch-complete", {
			added: adds,
			changed: changes,
			deleted: deletes
		});
	}
	async processBatchChanges(relativePaths) {
		await runInBatches(relativePaths, 500, (path) => this.fileOperations.updateFile(path));
	}
	async processBatchAdds(relativePaths) {
		await runInBatches(relativePaths, 500, async (path) => {
			try {
				await this.fileOperations.addFile(path);
				devLogSuccess(`Added file: ${path}`);
			} catch (error) {
				console.error(`Failed to add file ${path}:`, error);
			}
		});
	}
	async processBatchDeletes(relativePaths) {
		for (const relativePath of relativePaths) {
			await this.fileOperations.deleteFile(relativePath);
			devLogSuccess(`Deleted file: ${relativePath}`);
		}
	}
};
function isEnvFile(path) {
	const basename = path.split("/").pop() || path;
	return basename === ".env" || basename.startsWith(".env.");
}
/** Paths watched but never added to the dependency graph. */
function isExternalPath(path) {
	return isEnvFile(path) || path === "warlock.config.ts";
}
async function runInBatches(items, size, fn) {
	if (items.length === 0) return;
	for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
//#endregion
export { FileEventHandler };

//# sourceMappingURL=file-event-handler.mjs.map