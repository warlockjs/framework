//#region ../../@warlock.js/core/src/container/index.ts
const containerMap = /* @__PURE__ */ new Map();
var Container = class {
	set(key, value) {
		containerMap.set(key, value);
	}
	get(key) {
		return containerMap.get(key);
	}
	/**
	* Check if a key exists in the container
	*/
	has(key) {
		return containerMap.has(key);
	}
	/**
	* Delete a key from the container
	*/
	delete(key) {
		containerMap.delete(key);
	}
};
const container = new Container();
//#endregion
export { container };

//# sourceMappingURL=index.mjs.map