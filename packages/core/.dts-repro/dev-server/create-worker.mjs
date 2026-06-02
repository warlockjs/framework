import { env } from "@mongez/dotenv";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
//#region ../../@warlock.js/core/src/dev-server/create-worker.ts
/**
* Create a worker that works in both dev (TypeScript) and production (JavaScript) environments.
*
* In development mode (DEV_SERVER_CORE env set), workers are loaded with tsx
* to support TypeScript execution. In production, compiled .js files are used.
*
* @param workerPath - Relative path to worker file WITHOUT extension (e.g., "./workers/ts-health.worker")
* @param baseUrl - The import.meta.url of the calling module (used to resolve relative paths)
* @param options - Additional worker options
* @returns A new Worker instance
*
* @example
* ```typescript
* // In FilesHealthcareManager
* const worker = createWorker(
*   "./workers/ts-health.worker",
*   import.meta.url,
*   { workerData: { cwd: process.cwd() } }
* );
* ```
*/
function createWorker(workerPath, baseUrl, options) {
	const isDevServerCore = env("DEV_SERVER_CORE");
	const workerFilePath = fileURLToPath(new URL(`${workerPath}${isDevServerCore ? ".ts" : ".js"}`, baseUrl));
	const workerOptions = { ...options };
	if (isDevServerCore) workerOptions.execArgv = [
		...options?.execArgv || [],
		"--import",
		"tsx/esm"
	];
	return new Worker(workerFilePath, workerOptions);
}
//#endregion
export { createWorker };

//# sourceMappingURL=create-worker.mjs.map