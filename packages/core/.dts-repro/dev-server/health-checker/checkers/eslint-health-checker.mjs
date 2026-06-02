import { BaseHealthChecker } from "./base-health-checker.mjs";
import path from "path";
import { colors } from "@mongez/copper";
import fs from "fs";
import { ESLint } from "eslint";
//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/eslint-health-checker.ts
var EslintHealthChecker = class extends BaseHealthChecker {
	constructor(..._args) {
		super(..._args);
		this.eslint = null;
		this.name = "ESLint";
		this.workerPath = "./workers/eslint-health.worker";
		this.initialized = false;
	}
	/**
	* Check if file is a lintable file
	*/
	isLintableFile(filePath) {
		const ext = filePath.toLowerCase();
		return ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".js") || ext.endsWith(".jsx");
	}
	/**
	* Initialize the health checker
	*/
	initialize() {
		try {
			const flatConfigPath = path.join(process.cwd(), "eslint.config.js");
			const flatConfigMjsPath = path.join(process.cwd(), "eslint.config.mjs");
			const flatConfigCjsPath = path.join(process.cwd(), "eslint.config.cjs");
			if (!(fs.existsSync(flatConfigPath) || fs.existsSync(flatConfigMjsPath) || fs.existsSync(flatConfigCjsPath))) {
				this.initialized = true;
				return this;
			}
			this.eslint = new ESLint({ cwd: process.cwd() });
			this.initialized = true;
		} catch (error) {
			console.warn("ESLint Health Checker: Failed to initialize:", error);
			this.initialized = true;
		}
		return this;
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
				const ruleId = error.ruleId || "eslint";
				console.log(`  ${colors.magentaBright(ruleId)} ${colors.dim("→")} ${colors.red(error.message)}`);
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
				const ruleId = warning.ruleId || "eslint";
				console.log(`  ${colors.magentaBright(ruleId)} ${colors.dim("→")} ${colors.yellow(warning.message)}`);
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
	* Validate the health of the file
	*/
	async validate(file, result) {
		if (!this.isLintableFile(file.absolutePath)) {
			result.markAsHealthy();
			return result;
		}
		if (!this.eslint) {
			result.markAsHealthy();
			return result;
		}
		try {
			const lintResults = await this.eslint.lintText(file.source, { filePath: file.absolutePath });
			if (lintResults.length === 0) {
				console.log("No lint results", file.relativePath);
				result.markAsHealthy();
				return result;
			}
			const lintResult = lintResults[0];
			const errors = [];
			const warnings = [];
			for (const message of lintResult.messages) {
				const isError = message.severity === 2;
				const isWarning = message.severity === 1;
				if (isError) errors.push({
					message: message.message,
					type: "error",
					lineNumber: message.line || 1,
					columnNumber: message.column || 1,
					length: message.endColumn && message.column ? message.endColumn - message.column : 1,
					ruleId: message.ruleId || void 0
				});
				else if (isWarning) warnings.push({
					message: message.message,
					type: "warning",
					lineNumber: message.line || 1,
					columnNumber: message.column || 1,
					length: message.endColumn && message.column ? message.endColumn - message.column : 1,
					ruleId: message.ruleId || void 0
				});
			}
			if (errors.length > 0) result.addErrors(errors);
			if (warnings.length > 0) result.addWarnings(warnings);
			if (errors.length === 0 && warnings.length === 0) result.markAsHealthy();
			else this.displayResults(file, result);
		} catch (error) {
			console.log("ESlint Error:", error);
			result.markAsHealthy();
		}
		return result;
	}
};
//#endregion
export { EslintHealthChecker };

//# sourceMappingURL=eslint-health-checker.mjs.map