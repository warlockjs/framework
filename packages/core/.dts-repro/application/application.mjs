import { environment, setEnvironment } from "../utils/environment.mjs";
import { appPath, publicPath, rootPath, srcPath, storagePath, uploadsPath } from "../utils/paths.mjs";
import { getFrameworkVersion } from "../utils/framework-vesion.mjs";
//#region ../../@warlock.js/core/src/application/application.ts
var Application = class {
	static {
		this.startedAt = /* @__PURE__ */ new Date(Date.now() - process.uptime() * 1e3);
	}
	/**
	* Get framework version
	*/
	static get version() {
		return getFrameworkVersion();
	}
	/**
	* Set the runtime strategy
	*/
	static setRuntimeStrategy(strategy) {
		this.runtimeStrategy = strategy;
	}
	/**
	* Get project uptime in milliseconds
	*/
	static get uptime() {
		return process.uptime() * 1e3;
	}
	/**
	* Get the current environment
	*/
	static get environment() {
		return environment();
	}
	/**
	* Set the current environment
	*/
	static setEnvironment(env) {
		setEnvironment(env);
	}
	/**
	* Check if the application is running in production environment
	*/
	static get isProduction() {
		return this.environment === "production";
	}
	/**
	* Check if the application is running in development environment
	*/
	static get isDevelopment() {
		return this.environment === "development";
	}
	/**
	* Check if the application is running in test environment
	*/
	static get isTest() {
		return this.environment === "test";
	}
	/**
	* Get the root path
	*/
	static get rootPath() {
		return rootPath();
	}
	/**
	* Get the src path
	*/
	static get srcPath() {
		return srcPath();
	}
	/**
	* Get the app path
	*/
	static get appPath() {
		return appPath();
	}
	/**
	* Get the storage path
	*/
	static get storagePath() {
		return storagePath();
	}
	/**
	* Get the uploads path
	*/
	static get uploadsPath() {
		return uploadsPath();
	}
	/**
	* Get the public path
	*/
	static get publicPath() {
		return publicPath();
	}
};
//#endregion
export { Application };

//# sourceMappingURL=application.mjs.map