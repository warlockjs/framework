import { MANIFEST_PATH } from "./flags.mjs";
import { fileExistsAsync, getJsonFileAsync, putFileAsync } from "@warlock.js/fs";
//#region ../../@warlock.js/core/src/dev-server/manifest-manager.ts
var ManifestManager = class {
	/**
	* Constructor
	*/
	constructor(files) {
		this.files = files;
		this.manifest = {
			version: "1.0.0",
			lastBuildTime: Date.now(),
			stats: {
				totalFiles: 0,
				totalDependencies: 0
			},
			files: {}
		};
	}
	/**
	* Initialize manifest manager
	* @returns true if manifest exists, false otherwise
	*/
	async init() {
		if (await fileExistsAsync(MANIFEST_PATH)) {
			this.manifest = await getJsonFileAsync(MANIFEST_PATH);
			return true;
		} else return false;
	}
	/**
	* Save manifest to disk
	*/
	async save() {
		this.manifest.stats.totalFiles = Object.keys(this.manifest.files).length;
		this.manifest.stats.totalDependencies = this.calculateTotalDependencies();
		this.manifest.lastBuildTime = Date.now();
		await putFileAsync(MANIFEST_PATH, JSON.stringify(this.manifest, null, 2));
	}
	/**
	* Get file manifest data
	*/
	getFile(filePath) {
		return this.manifest.files[filePath];
	}
	/**
	* Check if file exists in manifest
	*/
	hasFile(filePath) {
		return filePath in this.manifest.files;
	}
	/**
	* Set file manifest data
	*/
	setFile(filePath, fileManifest) {
		this.manifest.files[filePath] = fileManifest;
	}
	/**
	* Remove file from manifest
	*/
	removeFile(filePath) {
		delete this.manifest.files[filePath];
	}
	/**
	* Get all file paths in manifest
	*/
	getAllFilePaths() {
		return Object.keys(this.manifest.files);
	}
	/**
	* Get all file manifests
	*/
	getAllFiles() {
		return this.manifest.files;
	}
	/**
	* Get manifest metadata
	*/
	getMetadata() {
		return {
			version: this.manifest.version,
			lastBuildTime: this.manifest.lastBuildTime,
			projectHash: this.manifest.projectHash,
			stats: this.manifest.stats
		};
	}
	/**
	* Calculate total dependencies across all files
	*/
	calculateTotalDependencies() {
		return Object.values(this.manifest.files).reduce((total, file) => total + (file.dependencies?.length || 0), 0);
	}
	/**
	* Clear all files from manifest
	*/
	clear() {
		this.manifest.files = {};
		this.manifest.stats = {
			totalFiles: 0,
			totalDependencies: 0
		};
	}
};
//#endregion
export { ManifestManager };

//# sourceMappingURL=manifest-manager.mjs.map