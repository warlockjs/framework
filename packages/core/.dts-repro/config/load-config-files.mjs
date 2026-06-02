import { srcPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "../dev-server/path.mjs";
import { getCertainFilesFromDirectory, getFilesFromDirectory } from "../dev-server/utils.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { configManager } from "./config-manager.mjs";
//#region ../../@warlock.js/core/src/config/load-config-files.ts
/**
* Load config files
* either config file names (without extensions) or true to load all config files
*/
async function loadConfigFiles(config) {
	let relativePaths = [];
	if (config === true) relativePaths = (await getFilesFromDirectory(srcPath("config"))).map((path) => Path.toRelative(path));
	else relativePaths = (await getCertainFilesFromDirectory(srcPath("config"), config)).map((path) => Path.toRelative(path));
	const configFiles = await Promise.all(relativePaths.map((relativePath) => filesOrchestrator.add(relativePath)));
	filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.files);
	await configManager.loadAll(configFiles);
}
//#endregion
export { loadConfigFiles };

//# sourceMappingURL=load-config-files.mjs.map