import { Path } from "./path.mjs";
import { getJsonFileAsync } from "@warlock.js/fs";
//#region ../../@warlock.js/core/src/dev-server/package-json-manager.ts
var PackageJsonManager = class {
	constructor() {
		this.packageJson = {};
	}
	/**
	* Initialize the package.json manager
	*/
	async init() {
		this.packageJson = await getJsonFileAsync(Path.toAbsolute("package.json"));
	}
	/**
	* Check if the given path is a package path
	*/
	isPathPackage(path) {
		return Object.keys(this.packageJson.dependencies || {}).concat(Object.keys(this.packageJson.devDependencies || {})).some((packageName) => path.startsWith(packageName));
	}
};
const packageJsonManager = new PackageJsonManager();
//#endregion
export { packageJsonManager };

//# sourceMappingURL=package-json-manager.mjs.map