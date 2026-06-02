import { srcPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "../dev-server/path.mjs";
import { getFilesFromDirectory } from "../dev-server/utils.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { isMatchingCommandName } from "./cli-commands.utils.mjs";
//#region ../../@warlock.js/core/src/cli/commands-loader.ts
var CLICommandsLoader = class {
	/**
	* Locate command by name
	*/
	async locate(commandName) {
		const relativeFiles = (await getFilesFromDirectory(srcPath("app"), "**/commands/*.{ts,tsx}")).map((path) => Path.toRelative(path));
		for (const relativeFile of relativeFiles) {
			const command = await this.load(relativeFile);
			if (command) {
				command.$relativePath(relativeFile);
				if (isMatchingCommandName(command.name, commandName)) return command;
			}
		}
	}
	/**
	* Scan all project commands and return them
	* Used for warm cache functionality
	*/
	async scanAll() {
		const relativeFiles = (await getFilesFromDirectory(srcPath("app"), "**/commands/*.{ts,tsx}")).map((path) => Path.toRelative(path));
		const commands = [];
		for (const relativeFile of relativeFiles) {
			const command = await this.load(relativeFile);
			if (command) {
				command.$relativePath(relativeFile);
				commands.push(command);
			}
		}
		return commands;
	}
	/**
	* Load command from a relative path
	*/
	async load(relativePath) {
		return (await filesOrchestrator.load(relativePath))?.default;
	}
};
const cliCommandsLoader = new CLICommandsLoader();
//#endregion
export { cliCommandsLoader };

//# sourceMappingURL=commands-loader.mjs.map