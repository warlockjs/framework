import path from "node:path";
//#region ../../@warlock.js/core/src/dev-server/path.ts
var Path = class {
	/**
	* Convert the given absolute path to a relative path
	*/
	static toRelative(absolutePath) {
		return this.normalize(path.relative(process.cwd(), absolutePath));
	}
	/**
	* Get relative path of the given path
	*/
	static relative(relativePath) {
		return this.normalize(path.relative(process.cwd(), relativePath));
	}
	/**
	* Get normalized absolute path of the given path
	*/
	static toNormalizedAbsolute(relativePath) {
		return this.normalize(path.resolve(process.cwd(), relativePath));
	}
	/**
	* Get absolute path of the given path
	*/
	static toAbsolute(relativePath) {
		return this.normalize(path.resolve(process.cwd(), relativePath));
	}
	/**
	* Normalize the given path (convert backslashes to forward slashes)
	*/
	static normalize(filePath) {
		return filePath.replace(/\\/g, "/");
	}
	/**
	* Join paths and normalize
	*/
	static join(...paths) {
		return this.normalize(path.join(...paths));
	}
	/**
	* Get directory name of a path
	*/
	static dirname(filePath) {
		return this.normalize(path.dirname(filePath));
	}
	/**
	* Get base name of a path
	*/
	static basename(filePath, ext) {
		return path.basename(filePath, ext);
	}
	/**
	* Get extension of a path
	*/
	static extname(filePath) {
		return path.extname(filePath);
	}
};
//#endregion
export { Path };

//# sourceMappingURL=path.mjs.map