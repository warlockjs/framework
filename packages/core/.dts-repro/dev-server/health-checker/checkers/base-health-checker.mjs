import { FileHealthResult } from "../file-health-result.mjs";
//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/base-health-checker.ts
var BaseHealthChecker = class {
	constructor() {
		this.files = /* @__PURE__ */ new Map();
	}
	/**
	* Detect when files are changed
	*/
	async onFileChanges(files) {}
	/**
	* Remove the given file from the checker
	*/
	removeFile(file) {
		this.files.delete(file.relativePath);
		return this;
	}
	/**
	* Validate the health of the file
	*/
	async check(file) {
		const result = new FileHealthResult();
		this.files.set(file.relativePath, {
			file,
			healthResult: result
		});
		return await this.validate(file, result);
	}
	/**
	* Get the stats of the health checker
	*/
	async stats() {
		const result = {
			name: this.name,
			files: {
				healthy: 0,
				defective: 0
			},
			warnings: {
				total: 0,
				totalFiles: 0
			},
			errors: {
				total: 0,
				totalFiles: 0
			}
		};
		for (const file of this.files.values()) {
			const stats = file.healthResult.getStats();
			const isHealthy = stats.state === "healthy";
			result.files.healthy += isHealthy ? 1 : 0;
			result.files.defective += !isHealthy ? 1 : 0;
			result.warnings.total += stats.warnings;
			result.warnings.totalFiles += stats.warnings > 0 ? 1 : 0;
			result.errors.total += stats.errors;
			result.errors.totalFiles += stats.errors > 0 ? 1 : 0;
		}
		return result;
	}
};
//#endregion
export { BaseHealthChecker };

//# sourceMappingURL=base-health-checker.mjs.map