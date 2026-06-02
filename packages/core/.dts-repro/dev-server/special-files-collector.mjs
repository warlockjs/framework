//#region ../../@warlock.js/core/src/dev-server/special-files-collector.ts
/**
* Categorises files into the kinds the dev server treats specially
* (config / main / route / event / locale) and exposes typed accessors.
*/
var SpecialFilesCollector = class {
	constructor() {
		this.buckets = {
			config: /* @__PURE__ */ new Map(),
			main: /* @__PURE__ */ new Map(),
			route: /* @__PURE__ */ new Map(),
			event: /* @__PURE__ */ new Map(),
			locale: /* @__PURE__ */ new Map()
		};
	}
	collect(files) {
		for (const bucket of Object.values(this.buckets)) bucket.clear();
		for (const [relativePath, fileManager] of files) this.categorise(relativePath, fileManager);
	}
	addFile(fileManager) {
		this.categorise(fileManager.relativePath, fileManager);
	}
	removeFile(relativePath) {
		for (const bucket of Object.values(this.buckets)) bucket.delete(relativePath);
	}
	updateFile(fileManager) {
		this.removeFile(fileManager.relativePath);
		this.categorise(fileManager.relativePath, fileManager);
	}
	getFileType(relativePath) {
		for (const [type, bucket] of Object.entries(this.buckets)) if (bucket.has(relativePath)) return type;
		return null;
	}
	getFilesByType(type) {
		const files = Array.from(this.buckets[type].values());
		if (type === "route") files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
		return files;
	}
	getStats() {
		return {
			config: this.buckets.config.size,
			main: this.buckets.main.size,
			route: this.buckets.route.size,
			event: this.buckets.event.size,
			locale: this.buckets.locale.size
		};
	}
	clear() {
		for (const bucket of Object.values(this.buckets)) bucket.clear();
	}
	categorise(relativePath, fileManager) {
		if (isConfigFile(relativePath)) this.buckets.config.set(relativePath, fileManager);
		else if (isMainFile(relativePath)) this.buckets.main.set(relativePath, fileManager);
		else if (isRouteFile(relativePath)) this.buckets.route.set(relativePath, fileManager);
		else if (isEventFile(relativePath)) this.buckets.event.set(relativePath, fileManager);
		else if (isLocaleFile(relativePath)) this.buckets.locale.set(relativePath, fileManager);
	}
};
const isConfigFile = (path) => /^src\/config\/.*\.(ts|tsx)$/.test(path);
const isMainFile = (path) => /^src\/app\/[^/]+\/main\.(ts|tsx)$/.test(path) || path === "src/app/main.ts" || path === "src/app/main.tsx";
const isRouteFile = (path) => /^src\/app\/[^/]+\/routes\.(ts|tsx)$/.test(path);
const isEventFile = (path) => /^src\/app\/[^/]+\/events\/[^/]+\.(ts|tsx)$/.test(path);
const isLocaleFile = (path) => /^src\/app\/[^/]+\/utils\/locales\.(ts|tsx)$/.test(path);
//#endregion
export { SpecialFilesCollector };

//# sourceMappingURL=special-files-collector.mjs.map