import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { Application } from "../application/application.mjs";
import { bootstrap } from "../bootstrap.mjs";
import { connectorsManager } from "../connectors/connectors-manager.mjs";
import "../connectors/index.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { loadConfigFiles } from "../config/load-config-files.mjs";
//#region ../../@warlock.js/core/src/tests/vitest-setup.ts
let isSetupComplete = false;
/**
* Setup function that runs once per worker thread
*/
async function setupTest({ connectors = true }) {
	if (isSetupComplete) return;
	try {
		Application.setEnvironment("test");
		await warlockConfigManager.load();
		await bootstrap();
		await filesOrchestrator.init();
		await loadConfigFiles(true);
		const connectorsToStart = config.get("tests").connectors || connectors;
		if (Array.isArray(connectorsToStart)) await connectorsManager.start(connectorsToStart);
		else await connectorsManager.startWithout(["http"]);
		isSetupComplete = true;
	} catch (error) {
		console.error("[vitest-setup] Failed to setup test environment:", error);
		throw error;
	}
}
//#endregion
export { setupTest };

//# sourceMappingURL=vitest-setup.mjs.map