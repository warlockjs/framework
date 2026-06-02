import { tsconfigManager } from "../../tsconfig-manager.mjs";
import { BaseHealthChecker } from "./base-health-checker.mjs";
import { colors } from "@mongez/copper";
import ts from "typescript";
//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/typescript-health-checker.ts
var TypescriptHealthChecker = class extends BaseHealthChecker {
	constructor(..._args) {
		super(..._args);
		this.program = null;
		this.parsedConfig = null;
		this.name = "TypeScript";
		this.workerPath = "./workers/ts-health.worker";
		this.initialized = false;
	}
	/**
	* Check if file is a TypeScript file
	*/
	isTypeScriptFile(filePath) {
		const ext = filePath.toLowerCase();
		return ext.endsWith(".ts") || ext.endsWith(".tsx");
	}
	/**
	* Extract line and column from diagnostic location
	*/
	getDiagnosticLocation(diagnostic) {
		if (diagnostic.file && diagnostic.start !== void 0) {
			const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
			return {
				lineNumber: line + 1,
				columnNumber: character + 1
			};
		}
		return {
			lineNumber: 1,
			columnNumber: 1
		};
	}
	/**
	* Format diagnostic message
	*/
	formatDiagnosticMessage(diagnostic) {
		if (diagnostic.file && diagnostic.start !== void 0) return ts.formatDiagnostic(diagnostic, {
			getCurrentDirectory: () => process.cwd(),
			getCanonicalFileName: (fileName) => fileName,
			getNewLine: () => "\n"
		});
		return diagnostic.messageText.toString();
	}
	/**
	* Display health check results in a pretty format
	*/
	displayResults(file, result) {
		const stats = result.getStats();
		if (stats.errors === 0 && stats.warnings === 0) return;
		const fileName = file.relativePath.replace(/\\/g, "/");
		const errorCount = stats.errors;
		const warningCount = stats.warnings;
		const sourceLines = file.source ? file.source.split("\n") : [];
		if (errorCount > 0) {
			const errorMessages = result.messages.filter((m) => m.type === "error");
			for (const error of errorMessages) {
				const icon = colors.redBright("✖");
				const level = colors.redBright(colors.bold("ERROR"));
				console.log(`\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${error.lineNumber},${error.columnNumber})`)}`);
				const cleanMessage = error.message.split("\n").map((line) => line.replace(/^[^:]+:\d+:\d+ - /, "").trim()).filter((line) => line.length > 0).join("\n");
				console.log(`  ${colors.dim("→")} ${colors.red(cleanMessage)}`);
				if (sourceLines.length > 0 && error.lineNumber > 0 && error.lineNumber <= sourceLines.length) {
					const lineContent = sourceLines[error.lineNumber - 1];
					const lineNum = error.lineNumber.toString().padStart(4, " ");
					const errorLength = error.length || 1;
					const columnIndex = error.columnNumber - 1;
					console.log(`  ${colors.dim(lineNum)} ${colors.dim("│")} ${lineContent || ""}`);
					const prefixPadding = lineNum.length + 3;
					const columnPadding = " ".repeat(columnIndex);
					const underline = colors.redBright("~".repeat(Math.max(1, errorLength)));
					console.log(`  ${colors.dim(" ".repeat(prefixPadding))}${columnPadding}${underline}`);
				}
			}
		}
		if (warningCount > 0) {
			const warningMessages = result.messages.filter((m) => m.type === "warning");
			for (const warning of warningMessages) {
				const icon = colors.yellowBright("⚠");
				const level = colors.yellowBright(colors.bold("WARNING"));
				console.log(`\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${warning.lineNumber},${warning.columnNumber})`)}`);
				const cleanMessage = warning.message.split("\n").map((line) => line.replace(/^[^:]+:\d+:\d+ - /, "").trim()).filter((line) => line.length > 0).join("\n");
				console.log(`  ${colors.dim("→")} ${colors.yellow(cleanMessage)}`);
				if (sourceLines.length > 0 && warning.lineNumber > 0 && warning.lineNumber <= sourceLines.length) {
					const lineContent = sourceLines[warning.lineNumber - 1];
					const lineNum = warning.lineNumber.toString().padStart(4, " ");
					const warningLength = warning.length || 1;
					const columnIndex = warning.columnNumber - 1;
					console.log(`  ${colors.dim(lineNum)} ${colors.dim("│")} ${lineContent || ""}`);
					const prefixPadding = lineNum.length + 3;
					const columnPadding = " ".repeat(columnIndex);
					const underline = colors.yellowBright("~".repeat(Math.max(1, warningLength)));
					console.log(`  ${colors.dim(" ".repeat(prefixPadding))}${columnPadding}${underline}`);
				}
			}
		}
		const summary = [];
		if (errorCount > 0) summary.push(colors.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`));
		if (warningCount > 0) summary.push(colors.yellow(`${warningCount} warning${warningCount > 1 ? "s" : ""}`));
	}
	/**
	* Detect when files are changed
	*/
	async onFileChanges(files) {
		if (!this.parsedConfig) return;
		this.program = ts.createProgram(files.map((file) => file.absolutePath), {
			...this.parsedConfig.options,
			incremental: true
		}, void 0, this.program);
	}
	/**
	* Initialize the health checker
	*/
	initialize() {
		try {
			if (!tsconfigManager.tsconfig || Object.keys(tsconfigManager.tsconfig).length === 0) {
				this.initialized = true;
				return this;
			}
			this.parsedConfig = ts.parseJsonConfigFileContent(tsconfigManager.tsconfig, ts.sys, process.cwd());
			if (this.parsedConfig.errors.length > 0) console.warn("TypeScript Health Checker: tsconfig.json has errors:", this.parsedConfig.errors.map((e) => ts.formatDiagnostic(e, ts.createCompilerHost({}))));
			this.program = ts.createProgram(this.parsedConfig.fileNames, this.parsedConfig.options);
			this.initialized = true;
		} catch (error) {
			console.warn("TypeScript Health Checker: Failed to initialize:", error);
			this.initialized = true;
		}
		return this;
	}
	/**
	* Validate the health of the file
	*/
	async validate(file, result) {
		if (!this.isTypeScriptFile(file.absolutePath)) {
			result.markAsHealthy();
			return result;
		}
		if (!this.parsedConfig) {
			result.markAsHealthy();
			return result;
		}
		try {
			if (!this.program) this.program = ts.createProgram(this.parsedConfig.fileNames, this.parsedConfig.options);
			const sourceFile = this.program.getSourceFile(file.absolutePath);
			if (!sourceFile) {
				result.markAsHealthy();
				return result;
			}
			const syntacticDiagnostics = this.program.getSyntacticDiagnostics(sourceFile);
			const semanticDiagnostics = this.program.getSemanticDiagnostics(sourceFile);
			const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];
			const errors = [];
			const warnings = [];
			for (const diagnostic of allDiagnostics) {
				const location = this.getDiagnosticLocation(diagnostic);
				const message = this.formatDiagnosticMessage(diagnostic);
				const errorLength = diagnostic.length || 1;
				if (diagnostic.category === ts.DiagnosticCategory.Error) errors.push({
					message,
					type: "error",
					lineNumber: location.lineNumber,
					columnNumber: location.columnNumber,
					length: errorLength
				});
				else if (diagnostic.category === ts.DiagnosticCategory.Warning) warnings.push({
					message,
					type: "warning",
					lineNumber: location.lineNumber,
					columnNumber: location.columnNumber,
					length: errorLength
				});
			}
			if (errors.length > 0) result.addErrors(errors);
			if (warnings.length > 0) result.addWarnings(warnings);
			if (errors.length === 0 && warnings.length === 0) result.markAsHealthy();
			else this.displayResults(file, result);
		} catch (error) {
			console.warn(`TypeScript Health Checker: Error validating file ${file.relativePath}:`, error);
			result.markAsHealthy();
		}
		return result;
	}
};
//#endregion
export { TypescriptHealthChecker };

//# sourceMappingURL=typescript-health-checker.mjs.map