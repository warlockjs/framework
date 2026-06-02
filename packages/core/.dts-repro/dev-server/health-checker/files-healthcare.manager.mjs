import { devLogInfo } from "../dev-logger.mjs";
import { createWorker } from "../create-worker.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/dev-server/health-checker/files-healthcare.manager.ts
/**
* Files Healthcare Manager
*
* Manages health checkers for file validation during development.
* Supports both main-thread and worker-based checkers.
*
* Checkers with `workerPath` run in dedicated worker threads for performance.
* Checkers without `workerPath` run in the main thread.
*
* @example
* ```typescript
* const manager = new FilesHealthcareManager(files);
*
* manager.setHealthCheckers([
*   new TypescriptHealthChecker(),  // Has workerPath → runs in worker
*   new CustomChecker(),             // No workerPath → runs in main thread
* ]);
*
* await manager.initialize();
* await manager.validateAllFiles();
* ```
*/
var FilesHealthcareManager = class {
	/**
	* Constructor
	* @param files - Map of tracked files
	*/
	constructor(files) {
		this.files = files;
		this.healthCheckers = [];
		this.workers = /* @__PURE__ */ new Map();
		this.workerInitPromises = /* @__PURE__ */ new Map();
		this.checkerStats = /* @__PURE__ */ new Map();
	}
	/**
	* Add health checkers to the manager
	* @param checkers - Checkers to add
	*/
	addHealthCheckers(...checkers) {
		this.healthCheckers.push(...checkers);
		return this;
	}
	/**
	* Set (replace) all health checkers
	* @param checkers - New set of checkers
	*/
	setHealthCheckers(checkers) {
		this.healthCheckers = checkers;
		return this;
	}
	/**
	* Initialize all health checkers
	*
	* For checkers with `workerPath`, spawns dedicated worker threads.
	* For other checkers, calls their `initialize()` method directly.
	*/
	async initialize() {
		const initPromises = this.healthCheckers.map(async (checker) => {
			this.checkerStats.set(checker.name, {
				totalFiles: 0,
				healthyFiles: 0,
				defectiveFiles: 0,
				totalErrors: 0,
				totalWarnings: 0,
				filesWithErrors: 0,
				filesWithWarnings: 0
			});
			if (checker.workerPath) await this.spawnWorker(checker);
			else checker.initialize();
		});
		await Promise.all(initPromises);
	}
	/**
	* Spawn a worker for a checker
	*/
	async spawnWorker(checker) {
		if (!checker.workerPath) return;
		const worker = createWorker(checker.workerPath, import.meta.url, { workerData: { cwd: process.cwd() } });
		this.workers.set(checker.name, worker);
		const initPromise = new Promise((resolve) => {
			const handler = (response) => {
				if (response.type === "initialized") {
					worker.off("message", handler);
					resolve(response.success);
				}
			};
			worker.on("message", handler);
			worker.on("error", (error) => {
				console.error(`Health Checker Worker Error (${checker.name}):`, error);
				resolve(false);
			});
			worker.postMessage({
				type: "init",
				config: { cwd: process.cwd() }
			});
		});
		this.workerInitPromises.set(checker.name, initPromise);
		await initPromise;
	}
	/**
	* Validate all tracked files
	*/
	async validateAllFiles() {
		const allFiles = Array.from(this.files.values());
		await this.checkFiles(allFiles);
		await this.displayStats();
	}
	/**
	* Check the given files with all registered checkers
	*
	* All checkers run in parallel for performance.
	* Worker-based checkers communicate via postMessage.
	* Main-thread checkers are called directly.
	*/
	async checkFiles(files) {
		const checkPromises = this.healthCheckers.map(async (checker) => {
			if (checker.workerPath) return this.runInWorker(checker.name, files);
			else return this.runInline(checker, files);
		});
		const results = await Promise.all(checkPromises);
		for (const checkerResults of results) for (const result of checkerResults) if (!result.healthy) this.displayFileResults(result);
	}
	/**
	* Run checker in worker thread
	*/
	async runInWorker(checkerName, files) {
		const worker = this.workers.get(checkerName);
		if (!worker) return files.map((f) => ({
			path: f.absolutePath,
			relativePath: f.relativePath,
			healthy: true,
			errors: [],
			warnings: []
		}));
		const initPromise = this.workerInitPromises.get(checkerName);
		if (initPromise) {
			if (!await initPromise) return files.map((f) => ({
				path: f.absolutePath,
				relativePath: f.relativePath,
				healthy: true,
				errors: [],
				warnings: []
			}));
		}
		const serializedFiles = files.map((f) => ({
			path: f.absolutePath,
			content: f.source,
			relativePath: f.relativePath
		}));
		return new Promise((resolve) => {
			const handler = (response) => {
				if (response.type === "results") {
					worker.off("message", handler);
					this.updateStats(checkerName, response.results);
					resolve(response.results);
				} else if (response.type === "error") {
					worker.off("message", handler);
					resolve(files.map((f) => ({
						path: f.absolutePath,
						relativePath: f.relativePath,
						healthy: true,
						errors: [],
						warnings: []
					})));
				}
			};
			worker.on("message", handler);
			worker.postMessage({
				type: "check",
				files: serializedFiles
			});
		});
	}
	/**
	* Run checker inline (main thread)
	*/
	async runInline(checker, files) {
		const results = [];
		for (const file of files) {
			const healthResult = await checker.check(file);
			const stats = healthResult.getStats();
			results.push({
				path: file.absolutePath,
				relativePath: file.relativePath,
				healthy: stats.state === "healthy",
				errors: healthResult.messages.filter((m) => m.type === "error").map((m) => ({
					type: "error",
					message: m.message,
					lineNumber: m.lineNumber,
					columnNumber: m.columnNumber,
					length: m.length || 1,
					filePath: file.absolutePath,
					relativePath: file.relativePath,
					ruleId: m.ruleId
				})),
				warnings: healthResult.messages.filter((m) => m.type === "warning").map((m) => ({
					type: "warning",
					message: m.message,
					lineNumber: m.lineNumber,
					columnNumber: m.columnNumber,
					length: m.length || 1,
					filePath: file.absolutePath,
					relativePath: file.relativePath,
					ruleId: m.ruleId
				}))
			});
		}
		const checkerResults = results;
		this.updateStats(checker.name, checkerResults);
		return results;
	}
	/**
	* Update aggregated stats for a checker
	*/
	updateStats(checkerName, results) {
		const stats = this.checkerStats.get(checkerName);
		if (!stats) return;
		for (const result of results) {
			stats.totalFiles++;
			if (result.healthy) stats.healthyFiles++;
			else stats.defectiveFiles++;
			stats.totalErrors += result.errors.length;
			stats.totalWarnings += result.warnings.length;
			if (result.errors.length > 0) stats.filesWithErrors++;
			if (result.warnings.length > 0) stats.filesWithWarnings++;
		}
	}
	/**
	* Detect when files are changed
	*/
	async onFileChanges(files) {
		const serializedFiles = files.map((f) => ({
			path: f.absolutePath,
			content: f.source,
			relativePath: f.relativePath
		}));
		for (const [, worker] of this.workers) worker.postMessage({
			type: "fileChanges",
			files: serializedFiles
		});
		await Promise.all(this.healthCheckers.filter((c) => !c.workerPath).map((c) => c.onFileChanges(files)));
	}
	/**
	* Remove files from tracking
	* Notifies both inline checkers and worker-based checkers about removed files
	*/
	removeFiles(files) {
		this.healthCheckers.filter((c) => !c.workerPath).forEach((checker) => files.forEach((file) => checker.removeFile(file)));
		if (files.length > 0) {
			const deletedPaths = files.map((f) => ({
				path: f.absolutePath,
				relativePath: f.relativePath
			}));
			for (const [, worker] of this.workers) worker.postMessage({
				type: "filesDeleted",
				files: deletedPaths
			});
		}
	}
	/**
	* Display file results (errors/warnings)
	*/
	displayFileResults(result) {
		const fileName = result.relativePath.replace(/\\/g, "/");
		for (const error of result.errors) {
			const icon = colors.redBright("✖");
			const level = colors.redBright(colors.bold("ERROR"));
			console.log(`\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${error.lineNumber},${error.columnNumber})`)}`);
			if (error.ruleId) console.log(`  ${colors.magentaBright(error.ruleId)} ${colors.dim("→")} ${colors.red(error.message)}`);
			else console.log(`  ${colors.dim("→")} ${colors.red(error.message)}`);
		}
		for (const warning of result.warnings) {
			const icon = colors.yellowBright("⚠");
			const level = colors.yellowBright(colors.bold("WARNING"));
			console.log(`\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${warning.lineNumber},${warning.columnNumber})`)}`);
			if (warning.ruleId) console.log(`  ${colors.magentaBright(warning.ruleId)} ${colors.dim("→")} ${colors.yellow(warning.message)}`);
			else console.log(`  ${colors.dim("→")} ${colors.yellow(warning.message)}`);
		}
	}
	/**
	* Display stats for all health checkers
	*/
	async displayStats() {
		const allStats = [];
		for (const checker of this.healthCheckers) {
			const stats = this.checkerStats.get(checker.name);
			if (stats) allStats.push({
				name: checker.name,
				files: {
					healthy: stats.healthyFiles,
					defective: stats.defectiveFiles
				},
				warnings: {
					total: stats.totalWarnings,
					totalFiles: stats.filesWithWarnings
				},
				errors: {
					total: stats.totalErrors,
					totalFiles: stats.filesWithErrors
				}
			});
		}
		console.log("\n");
		console.log(colors.bold(colors.cyan("━".repeat(80))));
		devLogInfo(colors.bold("  📊 Health Checker Statistics"));
		console.log(colors.bold(colors.cyan("━".repeat(80))));
		console.log("");
		allStats.forEach((stats, index) => {
			const totalFiles = stats.files.healthy + stats.files.defective;
			const hasIssues = stats.files.defective > 0;
			const statusIcon = hasIssues ? "⚠️" : "✅";
			console.log(colors.bold(`  ${statusIcon}  ${stats.name}`));
			console.log(colors.dim("  " + "─".repeat(76)));
			const filesLine = `     Files: ${colors.white(totalFiles.toString())} total  │  ${colors.green("✓ " + stats.files.healthy)} healthy  │  ${hasIssues ? colors.red("✗ " + stats.files.defective) : colors.dim("✗ 0")} defective`;
			console.log(filesLine);
			const warningsText = stats.warnings.total > 0 ? colors.yellow(`⚠ ${stats.warnings.total} warnings`) : colors.dim("⚠ 0 warnings");
			const errorsText = stats.errors.total > 0 ? colors.red(`✗ ${stats.errors.total} errors`) : colors.dim("✗ 0 errors");
			console.log(`     Issues: ${warningsText}  │  ${errorsText}`);
			if (index < allStats.length - 1) console.log("");
		});
		console.log("");
		console.log(colors.bold(colors.cyan("━".repeat(80))));
		console.log("");
	}
	/**
	* Shutdown all workers
	*/
	async shutdown() {
		for (const [name, worker] of this.workers) try {
			worker.postMessage({ type: "shutdown" });
			await worker.terminate();
		} catch {}
		this.workers.clear();
		this.workerInitPromises.clear();
		this.checkerStats.clear();
	}
};
//#endregion
export { FilesHealthcareManager };

//# sourceMappingURL=files-healthcare.manager.mjs.map