import path from "path";
import fs from "fs";
import { ESLint } from "eslint";
import { parentPort, workerData } from "worker_threads";
//#region ../../@warlock.js/core/src/dev-server/health-checker/workers/eslint-health.worker.ts
/**
* ESLint Health Check Worker
*
* This worker runs in a dedicated thread to perform ESLint linting
* without blocking the main dev server thread. It maintains a persistent
* ESLint instance for efficient linting.
*
* Communication:
* - Receives: { type: 'init' | 'check' | 'shutdown', ... }
* - Sends: { type: 'results' | 'initialized' | 'error', ... }
*/
/**
* ESLint Health Worker class
* Maintains persistent ESLint instance for efficient linting
*/
var ESLintHealthWorker = class {
	constructor() {
		this.eslint = null;
		this.initialized = false;
		this.hasConfig = false;
		this.cwd = process.cwd();
	}
	/**
	* Initialize the worker with ESLint configuration
	*/
	initialize(config) {
		try {
			this.cwd = config.cwd || process.cwd();
			const flatConfigPath = path.join(this.cwd, "eslint.config.js");
			const flatConfigMjsPath = path.join(this.cwd, "eslint.config.mjs");
			const flatConfigCjsPath = path.join(this.cwd, "eslint.config.cjs");
			this.hasConfig = fs.existsSync(flatConfigPath) || fs.existsSync(flatConfigMjsPath) || fs.existsSync(flatConfigCjsPath);
			if (!this.hasConfig) {
				this.initialized = true;
				return {
					success: true,
					hasConfig: false
				};
			}
			this.eslint = new ESLint({ cwd: this.cwd });
			this.initialized = true;
			return {
				success: true,
				hasConfig: true
			};
		} catch (error) {
			console.error("ESLint Worker: Failed to initialize:", error);
			this.initialized = true;
			return {
				success: false,
				hasConfig: false
			};
		}
	}
	/**
	* Check files for ESLint errors
	*/
	async checkFiles(files) {
		if (!this.eslint || !this.hasConfig) return files.map((file) => ({
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		}));
		const results = [];
		for (const file of files) {
			if (!this.isLintableFile(file.path)) {
				results.push({
					path: file.path,
					relativePath: file.relativePath,
					healthy: true,
					errors: [],
					warnings: []
				});
				continue;
			}
			try {
				const result = await this.checkSingleFile(file);
				results.push(result);
			} catch (error) {
				results.push({
					path: file.path,
					relativePath: file.relativePath,
					healthy: true,
					errors: [],
					warnings: []
				});
			}
		}
		return results;
	}
	/**
	* Check a single file for lint issues
	*/
	async checkSingleFile(file) {
		if (!this.eslint) return {
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		};
		const lintResults = await this.eslint.lintText(file.content, { filePath: file.path });
		if (lintResults.length === 0) return {
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		};
		const lintResult = lintResults[0];
		const errors = [];
		const warnings = [];
		for (const message of lintResult.messages) {
			const lintMessage = {
				type: message.severity === 2 ? "error" : "warning",
				message: message.message,
				lineNumber: message.line || 1,
				columnNumber: message.column || 1,
				length: message.endColumn && message.column ? message.endColumn - message.column : 1,
				filePath: file.path,
				relativePath: file.relativePath,
				ruleId: message.ruleId || void 0
			};
			if (message.severity === 2) errors.push(lintMessage);
			else if (message.severity === 1) warnings.push(lintMessage);
		}
		return {
			path: file.path,
			relativePath: file.relativePath,
			healthy: errors.length === 0 && warnings.length === 0,
			errors,
			warnings
		};
	}
	/**
	* Check if file is a lintable file
	*/
	isLintableFile(filePath) {
		const ext = filePath.toLowerCase();
		return ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".js") || ext.endsWith(".jsx");
	}
};
const worker = new ESLintHealthWorker();
parentPort?.on("message", async (message) => {
	try {
		switch (message.type) {
			case "init": {
				const initResult = worker.initialize(message.config);
				const response = {
					type: "initialized",
					success: initResult.success,
					hasConfig: initResult.hasConfig
				};
				parentPort?.postMessage(response);
				break;
			}
			case "check": {
				const response = {
					type: "results",
					results: await worker.checkFiles(message.files)
				};
				parentPort?.postMessage(response);
				break;
			}
			case "filesDeleted": break;
			case "shutdown": process.exit(0);
		}
	} catch (error) {
		const response = {
			type: "error",
			message: error instanceof Error ? error.message : String(error)
		};
		parentPort?.postMessage(response);
	}
});
if (workerData?.autoInit) worker.initialize({ cwd: workerData.cwd || process.cwd() });
//#endregion
export {};

//# sourceMappingURL=eslint-health.worker.mjs.map