import { Path } from "./path.mjs";
import { isTypeOnlyFile, parseImports } from "./parse-imports.mjs";
import { DEV_SERVER_EVENTS } from "./events.mjs";
import events from "@mongez/events";
import { getFileAsync, lastModifiedAsync } from "@warlock.js/fs";
import crypto from "crypto";
//#region ../../@warlock.js/core/src/dev-server/file-manager.ts
/**
* FileManager â€” per-file metadata for the dependency graph.
*
* The loader hook transpiles and caches on-demand at import time, so this
* class never touches disk for anything beyond reading source to hash it
* and parse its imports. Its job is keeping the metadata that the
* orchestrator needs to invalidate dependents on change.
*/
var FileManager = class {
	constructor(absolutePath, files, fileOperations) {
		this.absolutePath = absolutePath;
		this.files = files;
		this.fileOperations = fileOperations;
		this.relativePath = "";
		this.lastModified = 0;
		this.hash = "";
		this.source = "";
		this.dependencies = /* @__PURE__ */ new Set();
		this.typeOnlyDependencies = /* @__PURE__ */ new Set();
		this.importMap = /* @__PURE__ */ new Map();
		this.dependents = /* @__PURE__ */ new Set();
		this.cleanup = [];
		this.isTypeOnlyFile = false;
		this.state = "idle";
	}
	addCleanup(cleanup) {
		const next = Array.isArray(cleanup) ? cleanup : [cleanup];
		this.cleanup.push(...next);
		this.cleanup = [...new Set(this.cleanup)];
	}
	resetCleanup() {
		this.cleanup = [];
	}
	/**
	* Initial setup. Restores from manifest if the hash still matches,
	* otherwise re-processes from disk.
	*/
	async init(fileManifest) {
		this.relativePath = Path.toRelative(this.absolutePath);
		this.detectFileType();
		if (fileManifest) await this.initFromManifest(fileManifest);
		else await this.process();
	}
	/**
	* Read source, hash, parse imports, emit ready. The only file-system
	* touch happens here; transpilation is the loader hook's job.
	*
	* @param force - re-parse even when the hash matches.
	* @returns true if the file was (re)parsed.
	*/
	async process({ force = false } = {}) {
		if (!this.relativePath) this.relativePath = Path.toRelative(this.absolutePath);
		if (!this.type) this.detectFileType();
		this.state = "loading";
		let newSource;
		try {
			newSource = await getFileAsync(this.absolutePath);
		} catch {
			this.state = "deleted";
			return false;
		}
		const newHash = crypto.createHash("sha256").update(newSource).digest("hex");
		if (!force && newHash === this.hash) {
			this.state = "ready";
			return false;
		}
		this.source = newSource;
		this.hash = newHash;
		this.lastModified = (await lastModifiedAsync(this.absolutePath)).getTime();
		await this.rebuildImportMetadata();
		this.isTypeOnlyFile = isTypeOnlyFile(this.source);
		this.state = "ready";
		events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
		return true;
	}
	/**
	* Parse the current source and refresh `importMap`, `dependencies`, and
	* `typeOnlyDependencies`. A dependency is classified type-only iff every
	* import/export statement that resolves to it is type-only â€” a single
	* runtime reference makes the whole edge runtime.
	*/
	async rebuildImportMetadata() {
		const resolved = await parseImports(this.source, this.absolutePath);
		this.importMap = /* @__PURE__ */ new Map();
		this.dependencies = /* @__PURE__ */ new Set();
		this.typeOnlyDependencies = /* @__PURE__ */ new Set();
		const runtimePaths = /* @__PURE__ */ new Set();
		for (const [originalPath, { absolutePath, isTypeOnly }] of resolved) {
			this.importMap.set(originalPath, absolutePath);
			const relativePath = Path.toRelative(absolutePath);
			this.dependencies.add(relativePath);
			if (!isTypeOnly) runtimePaths.add(relativePath);
		}
		for (const dependency of this.dependencies) if (!runtimePaths.has(dependency)) this.typeOnlyDependencies.add(dependency);
	}
	/**
	* Restore from a cached manifest entry. If the on-disk hash matches the
	* manifest hash, dep-graph metadata is restored from the manifest without
	* re-parsing. Otherwise the file is reprocessed.
	*/
	async initFromManifest(fileManifest) {
		this.type = fileManifest.type;
		this.state = "loading";
		try {
			this.source = await getFileAsync(this.absolutePath);
		} catch {
			this.state = "deleted";
			return;
		}
		if (crypto.createHash("sha256").update(this.source).digest("hex") !== fileManifest.hash) {
			await this.process({ force: true });
			return;
		}
		this.hash = fileManifest.hash;
		this.lastModified = fileManifest.lastModified;
		this.dependencies = new Set(fileManifest.dependencies || []);
		this.typeOnlyDependencies = new Set(fileManifest.typeOnlyDependencies || []);
		this.dependents = new Set(fileManifest.dependents || []);
		this.state = "ready";
		events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
	}
	detectFileType() {
		const path = this.relativePath;
		if (path.includes("main.ts") || path.includes("main.tsx")) this.type = "main";
		else if (path.startsWith("src/config/")) this.type = "config";
		else if (path.endsWith("routes.ts") || path.endsWith("routes.tsx")) this.type = "route";
		else if (path.includes("/events/")) this.type = "event";
		else if (path.includes("controller")) this.type = "controller";
		else if (path.includes("service")) this.type = "service";
		else if (path.endsWith(".model.ts")) this.type = "model";
		else this.type = "other";
	}
	toManifest() {
		return {
			absolutePath: this.absolutePath,
			relativePath: this.relativePath,
			lastModified: this.lastModified,
			hash: this.hash,
			dependencies: Array.from(this.dependencies),
			typeOnlyDependencies: Array.from(this.typeOnlyDependencies),
			dependents: Array.from(this.dependents),
			type: this.type
		};
	}
};
//#endregion
export { FileManager };

//# sourceMappingURL=file-manager.mjs.map