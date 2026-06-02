import { devLogError, devServeLog } from "./dev-logger.mjs";
import { DevelopmentServer } from "./development-server.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/dev-server/start-development-server.ts
let handlersRegistered = false;
/**
* Start the development server.
*
* Boots the file orchestrator, loads app modules, starts late-phase
* connectors, then wires graceful shutdown for SIGINT/SIGTERM (plus
* SIGHUP on Windows where Ctrl+C in spawned children lands as SIGHUP).
*
* If startup throws, shuts down cleanly and exits 1 — dev should die
* loudly rather than hang with a half-initialized state.
*/
async function startDevelopmentServer(options = {}) {
	process.setSourceMapsEnabled(true);
	const devServer = new DevelopmentServer(options);
	registerShutdownHandlers(devServer);
	try {
		await devServer.start();
	} catch (error) {
		devLogError(`Failed to start Development Server: ${error.message}`);
		await safeShutdown(devServer);
		process.exit(1);
	}
	return devServer;
}
/**
* Register signal handlers once per process. Guards against handler
* accumulation if `startDevelopmentServer` is invoked more than once
* (tests, programmatic restart).
*/
function registerShutdownHandlers(devServer) {
	if (handlersRegistered) return;
	handlersRegistered = true;
	const onSignal = (signal) => async () => {
		devServeLog(colors.yellow(`📡 Received ${signal}`));
		const ok = await safeShutdown(devServer);
		process.exit(ok ? 0 : 1);
	};
	process.on("SIGINT", onSignal("SIGINT"));
	process.on("SIGTERM", onSignal("SIGTERM"));
	if (process.platform === "win32") process.on("SIGHUP", onSignal("SIGHUP"));
}
/**
* Shut down the dev server without swallowing async errors. Returns
* whether shutdown completed cleanly so the caller picks the exit code.
*/
async function safeShutdown(devServer) {
	try {
		await devServer.shutdown();
		return true;
	} catch (error) {
		devLogError(`Shutdown failed: ${error.message}`);
		return false;
	}
}
//#endregion
export { startDevelopmentServer };

//# sourceMappingURL=start-development-server.mjs.map