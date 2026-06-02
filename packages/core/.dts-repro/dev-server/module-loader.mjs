import { router } from "../router/router.mjs";
import { devLogError, formatModuleNotFoundError } from "./dev-logger.mjs";
import { pathToFileURL } from "node:url";
//#region ../../@warlock.js/core/src/dev-server/module-loader.ts
/**
* The four "special" file kinds that the dev server eagerly imports at boot.
* Order matters: locales first (used by everything), events before main so
* listeners are registered when main runs, routes last so handlers are bound.
*/
const SPECIAL_TYPES = [
	"locale",
	"event",
	"main",
	"route"
];
/**
* Loads application modules through the ESM loader hook. The hook stamps
* `?v=N` on every import, so each reload is a fresh module without any
* userland cache-busting plumbing.
*/
var ModuleLoader = class {
	constructor(specialFilesCollector) {
		this.specialFilesCollector = specialFilesCollector;
		this.loadedModules = /* @__PURE__ */ new Map();
	}
	/**
	* Eagerly load every special file at boot, in the canonical order so
	* later phases (e.g. routes) see state earlier phases registered.
	*/
	async loadAll() {
		for (const type of SPECIAL_TYPES) for (const file of this.specialFilesCollector.getFilesByType(type)) await this.loadModule(file, type);
	}
	/**
	* Import a file through the loader hook. For routes, scopes the import in
	* `router.withSourceFile()` so the added routes carry their origin.
	*/
	async loadModule(file, type) {
		if (file.relativePath.endsWith(".env")) return void 0;
		globalThis.__currentModuleFile = file;
		try {
			const fileUrl = pathToFileURL(file.absolutePath).href;
			const load = async () => {
				const module = await import(fileUrl);
				this.loadedModules.set(file.absolutePath, module);
				this.registerCleanup(file, module);
				return module;
			};
			return type === "route" ? await router.withSourceFile(file.relativePath, load) : await load();
		} catch (error) {
			if (error.code === "ERR_MODULE_NOT_FOUND") devLogError(formatModuleNotFoundError(error));
			else devLogError(`Failed to load ${type}: ${file.relativePath} - ${error?.message || error}`, error);
			return;
		} finally {
			globalThis.__currentModuleFile = void 0;
		}
	}
	/**
	* Reload a previously-loaded special file. The version-bump that makes the
	* import fresh is done by the caller (layer-executor) before invoking this.
	* Routes are removed from the registry first so re-registration is clean.
	*/
	async reloadModule(file) {
		const moduleType = this.specialFilesCollector.getFileType(file.relativePath);
		if (!moduleType) return;
		this.runCleanup(file);
		if (moduleType === "route") router.removeRoutesBySourceFile(file.relativePath);
		this.loadedModules.delete(file.absolutePath);
		await this.loadModule(file, moduleType);
	}
	/**
	* Run every cleanup hook the file registered (or `$cleanup` on its exports)
	* and reset the list. Called once per HMR reload.
	*/
	runCleanup(file) {
		for (const hook of file.cleanup) try {
			if (typeof hook === "function") hook();
			else if (hook && typeof hook.unsubscribe === "function") hook.unsubscribe();
		} catch {}
		file.resetCleanup();
	}
	/**
	* Clean up after a file whose source was deleted from disk.
	*/
	cleanupDeletedModule(file) {
		this.loadedModules.delete(file.absolutePath);
		if (file.type === "route") router.removeRoutesBySourceFile(file.relativePath);
		this.runCleanup(file);
	}
	/**
	* Scan a freshly-loaded module for cleanup handlers and register them on
	* the FileManager so they run before the next reload. Priority: explicit
	* `export function cleanup()` → `.$cleanup` on any exported value.
	*/
	registerCleanup(file, module) {
		if (typeof module.cleanup === "function") {
			file.addCleanup(module.cleanup);
			return;
		}
		const cleanups = [];
		for (const exportedValue of Object.values(module)) {
			const cleanup = exportedValue?.$cleanup;
			if (typeof cleanup === "function") cleanups.push(cleanup.bind(exportedValue));
		}
		if (cleanups.length > 0) file.addCleanup(cleanups);
	}
};
//#endregion
export { ModuleLoader };

//# sourceMappingURL=module-loader.mjs.map