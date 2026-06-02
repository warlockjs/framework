//#region ../../@warlock.js/core/src/utils/environment.ts
function environment() {
	return process.env.NODE_ENV || "development";
}
function setEnvironment(env) {
	process.env.NODE_ENV = env;
}
//#endregion
export { environment, setEnvironment };

//# sourceMappingURL=environment.mjs.map