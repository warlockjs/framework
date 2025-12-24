import { filesOrchestrator } from "../dev2-server/files-orchestrator";
import { Path } from "../dev2-server/path";
import { getCertainFilesFromDirectory, getFilesFromDirectory } from "../dev2-server/utils";
import { srcPath } from "../utils";
import { configManager } from "./config-manager";

/**
 * Load config files
 * either config file names (without extensions) or true to load all config files
 */
export async function loadConfigFiles(config: string[] | true) {
  let relativePaths: string[] = [];
  if (config === true) {
    const configFilesAbsulatePaths = await getFilesFromDirectory(srcPath("config"));
    relativePaths = configFilesAbsulatePaths.map((path) => Path.toRelative(path));
  } else {
    // define only the given config files
    const configFilesAbsulatePaths = await getCertainFilesFromDirectory(srcPath("config"), config);
    relativePaths = configFilesAbsulatePaths.map((path) => Path.toRelative(path));
  }

  const configFiles = await Promise.all(
    relativePaths.map((relativePath) => filesOrchestrator.add(relativePath)),
  );

  filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.files);

  await configManager.loadAll(configFiles);
}
