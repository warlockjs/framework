import { Path } from "./path.mjs";
import { colors } from "@mongez/copper";
import dayjs from "dayjs";
//#region ../../@warlock.js/core/src/dev-server/dev-logger.ts
/**
* Dev server logger — Vite-style formatting helpers.
*/
function timestamp() {
	return colors.dim(`${dayjs().format("HH:mm:ss A")}`);
}
function devLog(message) {
	console.log(`${timestamp()} ${message}`);
}
function devLogSuccess(message) {
	console.log(`${timestamp()} ${colors.green("✓")} ${colors.green(message)}`);
}
/**
* Colourise a stack trace so the eye lands on *your* code.
*
* - Error header (`ReferenceError: x is not defined`) → bold red.
* - Frames in project `src/` → highlighted: a green `›` pointer, yellow
*   function name, cyan relative path, dim `:line:col`. These are almost
*   always where the bug is.
* - Framework (`@warlock.js`), `node_modules`, and `node:` internal frames
*   → dimmed and relativised. Still there for context, just out of the way.
*
* Source maps are enabled in dev, so the paths/lines here are already the
* original `.ts` locations — this only changes how they're painted.
*/
function formatErrorStack(stack) {
	const frame = /^(\s*)at (.+?) \((.+):(\d+):(\d+)\)$/;
	const bareFrame = /^(\s*)at (.+):(\d+):(\d+)$/;
	let headerDone = false;
	return stack.split("\n").map((line) => {
		const withFn = line.match(frame);
		const bare = line.match(bareFrame);
		if (!withFn && !bare) return headerDone ? colors.dim(line) : colors.bold(colors.red(line));
		headerDone = true;
		const fn = withFn ? withFn[2] : "";
		const file = withFn ? withFn[3] : bare[2];
		const lineNo = withFn ? withFn[4] : bare[3];
		const col = withFn ? withFn[5] : bare[4];
		const isNodeInternal = file.startsWith("node:");
		const isDep = file.includes("node_modules");
		const isFramework = /[\\/]@warlock\.js[\\/]/.test(file);
		const isUserCode = !isNodeInternal && !isDep && !isFramework;
		const rel = isNodeInternal ? file : Path.toRelative(file);
		const loc = `:${lineNo}:${col}`;
		if (isUserCode) return `  ${colors.green("›")} ${colors.dim("at")} ${colors.yellow(fn || "<anonymous>")} ${colors.cyan(rel)}${colors.dim(loc)}`;
		const label = fn ? `at ${fn} ${rel}${loc}` : `at ${rel}${loc}`;
		return `    ${colors.dim(label)}`;
	}).join("\n");
}
function devLogError(message, error) {
	console.log(`${timestamp()} ${colors.red("✗")} ${colors.red(message)}`);
	if (error?.stack) console.log(formatErrorStack(error.stack));
}
function devLogWarn(message) {
	console.log(`${timestamp()} ${colors.yellow("⚠")} ${colors.yellow(message)}`);
}
function devLogInfo(message) {
	console.log(`${timestamp()} ${colors.cyan(message)}`);
}
function devLogDim(message) {
	console.log(`${timestamp()} ${colors.dim(message)}`);
}
function devLogHMR(file, dependents) {
	const relativePath = Path.toRelative(file);
	const depInfo = dependents ? colors.dim(` +${dependents} module${dependents > 1 ? "s" : ""}`) : "";
	console.log(`${timestamp()} 🔥 ${colors.green("hmr update")} ${colors.dim(relativePath)}${depInfo}`);
}
function devLogReady(message) {
	console.log(`\n${timestamp()}  ${colors.green("➜")}  ${colors.bold(message)}`);
}
function devLogSection(title) {
	console.log(`\n${timestamp()} ${colors.bold(colors.cyan(title))}`);
}
/**
* Format ERR_MODULE_NOT_FOUND so the displayed paths are relative to the
* project root. The loader hook keeps source paths in the URL so we only
* need to strip the absolute prefix — no cache-path translation any more.
*/
function formatModuleNotFoundError(error, suggestions) {
	const match = error.message.match(/Cannot find module '([^']+)' imported from '([^']+)'/);
	if (!match) return error.message;
	const [, modulePath, importerPath] = match;
	const lines = [
		"",
		`${colors.red("❌ MODULE NOT FOUND")}`,
		"",
		`${colors.dim("Cannot find:")} ${colors.cyan(Path.toRelative(modulePath))}`,
		"",
		`${colors.dim("Imported by:")}`,
		`  ${colors.yellow("→")} ${colors.white(Path.toRelative(importerPath))}`
	];
	if (suggestions && suggestions.length > 0) {
		lines.push("");
		lines.push(`${colors.dim("Did you mean?")}`);
		suggestions.forEach((s) => lines.push(`  ${colors.cyan("→")} ${colors.green(s)}`));
	}
	lines.push("");
	return lines.join("\n");
}
/** @deprecated alias retained for older callers. Use `devLog` directly. */
const devServeLog = devLog;
//#endregion
export { devLogDim, devLogError, devLogHMR, devLogInfo, devLogReady, devLogSection, devLogSuccess, devLogWarn, devServeLog, formatModuleNotFoundError };

//# sourceMappingURL=dev-logger.mjs.map