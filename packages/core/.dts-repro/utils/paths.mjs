import baseConfig from "@mongez/config";
import path from "path";
//#region ../../@warlock.js/core/src/utils/paths.ts
/**
* Get root path or join the given paths to the root path
*/
function rootPath(...paths) {
	return path.resolve(process.cwd(), ...paths);
}
/**
* Get src directory path or join the given paths to the src directory path
*/
function srcPath(...paths) {
	return rootPath("src", ...paths);
}
/**
* Get the absolute path to the storage folder to the given path
*
* If no path is given, it will return the absolute path to the storage folder
*/
function storagePath(relativePath = "") {
	return rootPath("storage", relativePath);
}
/**
* Get the absolute path to the uploads folder to the given path
*
* If no path is given, it will return the absolute path to the uploads folder
*/
function uploadsPath(relativePath = "") {
	const configPath = baseConfig.get("uploads.root");
	if (!configPath) return rootPath("storage", "uploads", relativePath);
	return typeof configPath === "function" ? configPath(relativePath) : path.resolve(configPath, relativePath);
}
/**
* Get the absolute path to the public folder to the given path
*
* If no path is given, it will return the absolute path to the public folder
*/
function publicPath(relativePath = "") {
	return rootPath("public", relativePath);
}
/**
* Get the absolute path to the cache folder to the given path
*
* If no path is given, it will return the absolute path to the cache folder
*/
function cachePath(relativePath = "") {
	return rootPath("storage", "cache", relativePath);
}
/**
* App path
*/
function appPath(relativePath = "") {
	return rootPath("src/app", relativePath);
}
/**
* Get logs directory path
*/
function logsPath(relativePath = "") {
	return rootPath("storage/logs", relativePath);
}
/**
* Get a temp path
*/
function tempPath(relativePath = "") {
	return rootPath("storage/tmp", relativePath);
}
/**
* Remove any invalid characters from the file path using regex
* It should accept any language character, numbers, and the following characters: _ - .
*/
const invalidCharsRegex = /[<>:"/\\|?*]/g;
function sanitizePath(filePath) {
	return filePath.replace(invalidCharsRegex, "");
}
/**
* Warlock path
* PLEASE DO NOT add any files in this directory as it may be deleted
*/
function warlockPath(...path) {
	return rootPath(".warlock", ...path);
}
/**
* Get config directory path
*/
function configPath(...path) {
	return rootPath("src/config", ...path);
}
const paths = {
	root: rootPath,
	src: srcPath,
	storage: storagePath,
	logs: logsPath,
	uploads: uploadsPath,
	public: publicPath,
	cache: cachePath,
	app: appPath,
	temp: tempPath,
	warlock: warlockPath,
	config: configPath,
	sanitize: sanitizePath
};
//#endregion
export { appPath, cachePath, configPath, logsPath, paths, publicPath, rootPath, sanitizePath, srcPath, storagePath, tempPath, uploadsPath, warlockPath };

//# sourceMappingURL=paths.mjs.map