import { Application } from "../application/application.mjs";
import "../application/index.mjs";
import { bootstrap } from "../bootstrap.mjs";
import { connectorsManager } from "../connectors/connectors-manager.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { loadConfigFiles } from "../config/load-config-files.mjs";
//#region ../../@warlock.js/core/src/tests/start-http-development-server.ts
/**
* HTTP Test Server
*
* Starts a minimal HTTP server for testing.
* Unlike the full DevelopmentServer, this:
* - Does NOT watch files
* - Does NOT do HMR
* - Only starts connectors needed for HTTP requests
*
* Used in Vitest's globalSetup to start server once for all test workers.
*/
let isServerRunning = false;
/**
* Start the HTTP test server (minimal - no file watching)
* Call this in Vitest's globalSetup
*/
async function startHttpTestServer() {
	if (isServerRunning) {
		console.log("[test-server] Server already running, skipping start");
		return;
	}
	console.log("[test-server] Starting HTTP test server...");
	try {
		Application.setRuntimeStrategy("development");
		Application.setEnvironment("test");
		await warlockConfigManager.load();
		await bootstrap();
		await filesOrchestrator.init();
		await filesOrchestrator.initializeAll();
		await loadConfigFiles(true);
		await filesOrchestrator.moduleLoader.loadAll();
		await connectorsManager.start();
		isServerRunning = true;
	} catch (error) {
		throw error;
	}
}
/**
* Stop the HTTP test server
* Call this in Vitest's globalTeardown
*/
async function stopHttpTestServer() {
	if (!isServerRunning) {
		console.log("[test-server] No server to stop");
		return;
	}
	try {
		await connectorsManager.shutdown();
		isServerRunning = false;
		console.log("[test-server] HTTP test server stopped");
	} catch (error) {
		console.error("[test-server] Error stopping HTTP server:", error);
		throw error;
	}
}
/**
* Check if test server is running
*/
function isTestServerRunning() {
	return isServerRunning;
}
//#endregion
export { isTestServerRunning, startHttpTestServer, stopHttpTestServer };

//# sourceMappingURL=start-http-development-server.mjs.map