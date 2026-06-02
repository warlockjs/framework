import { Path } from "./path.mjs";
import path from "node:path";
import ts from "typescript";
//#region ../../@warlock.js/core/src/dev-server/tsconfig-manager.ts
var TSConfigManager = class {
	constructor() {
		this.aliases = {};
		this.baseUrl = ".";
	}
	init() {
		if (this.tsconfig) return;
		const output = ts.readConfigFile(Path.toAbsolute("tsconfig.json"), ts.sys.readFile);
		this.tsconfig = output.config;
		this.aliases = output.config?.compilerOptions?.paths || {};
		this.baseUrl = output.config?.compilerOptions?.baseUrl || ".";
	}
	/**
	* Check if the given path is an alias
	* This checks if it's a REAL path alias (not an external package alias)
	*
	* Real aliases map to local paths (e.g., app/* -> src/app/*, src/* -> src/*)
	* External package aliases map to themselves with @ prefix (e.g., @warlock.js/core -> @warlock.js/core)
	*/
	isAlias(path) {
		if (!this.tsconfig) this.init();
		return Object.keys(this.aliases).some((alias) => {
			const aliasPattern = alias.replace("/*", "");
			if (!path.startsWith(aliasPattern)) return false;
			const aliasTargets = this.aliases[alias];
			if (!Array.isArray(aliasTargets) || aliasTargets.length === 0) return false;
			if (aliasPattern.startsWith("@")) return false;
			return true;
		});
	}
	/**
	* Get the alias key that matches the given import path
	*/
	getMatchingAlias(path) {
		return Object.keys(this.aliases).find((alias) => {
			const aliasPattern = alias.replace("/*", "");
			return path.startsWith(aliasPattern);
		}) || null;
	}
	/**
	* Resolve an alias import path to a relative path based on tsconfig paths
	* Example: "app/users/services/get-users.service" -> "src/app/users/services/get-users.service"
	*
	* @param path - The import path with alias (e.g., "app/users/services/get-users.service")
	* @returns The resolved relative path or null if alias not found
	*/
	resolveAliasPath(checkingPath) {
		const aliasKey = this.getMatchingAlias(checkingPath);
		if (!aliasKey) return null;
		const aliasTargets = this.aliases[aliasKey];
		if (!Array.isArray(aliasTargets) || aliasTargets.length === 0) return null;
		const targetPattern = aliasTargets[0];
		const aliasPattern = aliasKey.replace("/*", "");
		const targetBase = targetPattern.replace("/*", "");
		const relativePart = checkingPath.substring(aliasPattern.length).replace(/^[/\\]/, "");
		const resolvedPath = path.join(targetBase, relativePart);
		return Path.normalize(resolvedPath);
	}
	/**
	* Resolve an alias import path to an absolute path
	* Example: "app/users/services/get-users.service" -> "/absolute/path/to/src/app/users/services/get-users.service"
	*
	* @param path - The import path with alias
	* @returns The resolved absolute path or null if alias not found
	*/
	resolveAliasToAbsolute(path) {
		const relativePath = this.resolveAliasPath(path);
		if (!relativePath) return null;
		return Path.normalize(Path.toAbsolute(relativePath));
	}
};
const tsconfigManager = new TSConfigManager();
//#endregion
export { tsconfigManager };

//# sourceMappingURL=tsconfig-manager.mjs.map