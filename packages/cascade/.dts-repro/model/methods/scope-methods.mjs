//#region ../../@warlock.js/cascade/src/model/methods/scope-methods.ts
function addGlobalModelScope(ModelClass, name, callback, options = {}) {
	ModelClass.globalScopes.set(name, {
		callback,
		timing: options.timing || "before"
	});
}
function removeGlobalModelScope(ModelClass, name) {
	ModelClass.globalScopes.delete(name);
}
function addLocalModelScope(ModelClass, name, callback) {
	ModelClass.localScopes.set(name, callback);
}
function removeLocalModelScope(ModelClass, name) {
	ModelClass.localScopes.delete(name);
}
//#endregion
export { addGlobalModelScope, addLocalModelScope, removeGlobalModelScope, removeLocalModelScope };

//# sourceMappingURL=scope-methods.mjs.map