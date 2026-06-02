import { appPath } from "../../../../utils/paths.mjs";
import "../../../../utils/index.mjs";
import { ensureDirectoryAsync as ensureDirectoryAsync$1 } from "./writer.mjs";
import { directoryExistsAsync, fileExistsAsync } from "@warlock.js/fs";
import path from "node:path";
//#region ../../@warlock.js/core/src/cli/commands/generate/utils/path-resolver.ts
/**
* Resolve module path
* Returns absolute path to module directory
*/
function resolveModulePath(module) {
	return appPath(module);
}
/**
* Resolve component path within a module
* @param module - Module name (e.g., "users")
* @param type - Component type (e.g., "controllers", "services")
* @param name - Component name (e.g., "create-user")
* @param extension - File extension (default: ".ts")
*/
function resolveComponentPath(module, type, name, extension = ".ts") {
	return path.join(resolveModulePath(module), type, `${name}${extension}`);
}
/**
* Check if module exists
*
* A module is a DIRECTORY under the app path, so this uses
* `directoryExistsAsync` — `fileExistsAsync` would resolve `false` for a folder
* and wrongly gate every module-scoped generator behind "module does not exist".
*/
async function moduleExists(module) {
	return await directoryExistsAsync(resolveModulePath(module));
}
/**
* Check if file exists
*/
async function componentExists(module, type, name, extension = ".ts") {
	return await fileExistsAsync(resolveComponentPath(module, type, name, extension));
}
/**
* Ensure directory exists, create if missing
*/
async function ensureDirectory(dirPath) {
	await ensureDirectoryAsync$1(dirPath);
}
/**
* Ensure component directory exists
*/
async function ensureComponentDirectory(module, type) {
	await ensureDirectory(path.join(resolveModulePath(module), type));
}
//#endregion
export { componentExists, ensureComponentDirectory, moduleExists, resolveComponentPath, resolveModulePath };

//# sourceMappingURL=path-resolver.mjs.map