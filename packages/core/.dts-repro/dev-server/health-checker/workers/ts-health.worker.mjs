import ts from "typescript";
import { parentPort, workerData } from "worker_threads";
//#region ../../@warlock.js/core/src/dev-server/health-checker/workers/ts-health.worker.ts
/**
* TypeScript Health Check Worker
*
* This worker runs in a dedicated thread to perform TypeScript type checking
* without blocking the main dev server thread. It maintains a persistent
* ts.Program instance for fast incremental type checking.
*
* Communication:
* - Receives: { type: 'init' | 'check' | 'fileChanges' | 'shutdown', ... }
* - Sends: { type: 'results' | 'initialized' | 'error', ... }
*/
/**
* TypeScript Health Worker class
* Maintains persistent ts.Program for incremental type checking
*/
var TypeScriptHealthWorker = class {
	constructor() {
		this.program = null;
		this.parsedConfig = null;
		this.fileContents = /* @__PURE__ */ new Map();
		this.initialized = false;
		this.cwd = process.cwd();
	}
	/**
	* Initialize the worker with TypeScript configuration
	*/
	initialize(config) {
		try {
			this.cwd = config.cwd || process.cwd();
			const tsconfigPath = config.tsconfigPath || ts.findConfigFile(this.cwd, ts.sys.fileExists);
			if (!tsconfigPath) {
				this.initialized = true;
				return true;
			}
			const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
			if (configFile.error) {
				console.warn("TypeScript Worker: Error reading tsconfig:", configFile.error);
				this.initialized = true;
				return true;
			}
			this.parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.cwd);
			if (this.parsedConfig.errors.length > 0) console.warn("TypeScript Worker: tsconfig has errors:", this.parsedConfig.errors);
			this.initialized = true;
			return true;
		} catch (error) {
			console.error("TypeScript Worker: Failed to initialize:", error);
			this.initialized = true;
			return false;
		}
	}
	/**
	* Check files for TypeScript errors
	*/
	checkFiles(files) {
		if (!this.parsedConfig) return files.map((file) => ({
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		}));
		for (const file of files) this.fileContents.set(file.path, file.content);
		this.program = ts.createProgram(Array.from(this.fileContents.keys()), this.parsedConfig.options, this.createCompilerHost(), this.program || void 0);
		const results = [];
		for (const file of files) {
			const result = this.checkSingleFile(file);
			results.push(result);
		}
		return results;
	}
	/**
	* Handle file changes (update program incrementally)
	*/
	handleFileChanges(files) {
		for (const file of files) this.fileContents.set(file.path, file.content);
		if (this.parsedConfig && this.program) this.program = ts.createProgram(Array.from(this.fileContents.keys()), this.parsedConfig.options, this.createCompilerHost(), this.program || void 0);
	}
	/**
	* Handle deleted files (remove from cache)
	*/
	handleFilesDeleted(files) {
		let hasChanges = false;
		for (const file of files) if (this.fileContents.has(file.path)) {
			this.fileContents.delete(file.path);
			hasChanges = true;
		}
		if (hasChanges && this.parsedConfig) this.program = ts.createProgram(Array.from(this.fileContents.keys()), this.parsedConfig.options, this.createCompilerHost(), this.program || void 0);
	}
	/**
	* Check a single file for diagnostics
	*/
	checkSingleFile(file) {
		if (!this.program) return {
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		};
		const sourceFile = this.program.getSourceFile(file.path);
		if (!sourceFile) return {
			path: file.path,
			relativePath: file.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		};
		const syntacticDiagnostics = this.program.getSyntacticDiagnostics(sourceFile);
		const semanticDiagnostics = this.program.getSemanticDiagnostics(sourceFile);
		const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];
		const errors = [];
		const warnings = [];
		for (const diagnostic of allDiagnostics) {
			const message = this.formatDiagnostic(diagnostic, file);
			if (diagnostic.category === ts.DiagnosticCategory.Error) errors.push(message);
			else if (diagnostic.category === ts.DiagnosticCategory.Warning) warnings.push(message);
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
	* Format a TypeScript diagnostic into our message format
	*/
	formatDiagnostic(diagnostic, file) {
		let lineNumber = 1;
		let columnNumber = 1;
		let length = 1;
		if (diagnostic.file && diagnostic.start !== void 0) {
			const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
			lineNumber = pos.line + 1;
			columnNumber = pos.character + 1;
			length = diagnostic.length || 1;
		}
		const messageText = typeof diagnostic.messageText === "string" ? diagnostic.messageText : diagnostic.messageText.messageText;
		return {
			type: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
			message: messageText,
			lineNumber,
			columnNumber,
			length,
			filePath: file.path,
			relativePath: file.relativePath
		};
	}
	/**
	* Create a custom compiler host that reads from in-memory cache
	*/
	createCompilerHost() {
		const defaultHost = ts.createCompilerHost(this.parsedConfig?.options || {});
		return {
			...defaultHost,
			readFile: (fileName) => {
				if (this.fileContents.has(fileName)) return this.fileContents.get(fileName);
				return defaultHost.readFile(fileName);
			},
			fileExists: (fileName) => {
				if (this.fileContents.has(fileName)) return true;
				return defaultHost.fileExists(fileName);
			}
		};
	}
};
const worker = new TypeScriptHealthWorker();
parentPort?.on("message", (message) => {
	try {
		switch (message.type) {
			case "init": {
				const response = {
					type: "initialized",
					success: worker.initialize(message.config)
				};
				parentPort?.postMessage(response);
				break;
			}
			case "check": {
				const response = {
					type: "results",
					results: worker.checkFiles(message.files)
				};
				parentPort?.postMessage(response);
				break;
			}
			case "fileChanges":
				worker.handleFileChanges(message.files);
				break;
			case "filesDeleted":
				worker.handleFilesDeleted(message.files);
				break;
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

//# sourceMappingURL=ts-health.worker.mjs.map