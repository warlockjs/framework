import { srcPath } from "../../utils/paths.mjs";
import "../../utils/index.mjs";
import { command } from "../cli-command.mjs";
import { Path } from "../../dev-server/path.mjs";
import { getFilesFromDirectory } from "../../dev-server/utils.mjs";
import { filesOrchestrator } from "../../dev-server/files-orchestrator.mjs";
import { typeGenerator } from "../../dev-server/type-generator.mjs";
//#region ../../@warlock.js/core/src/cli/commands/typings-generator.command.ts
const typingsGeneratorCommand = command({
	name: "generate.typings",
	description: "Generate type definitions for the project",
	options: [{
		text: "--files, -f",
		description: "Files to generate typings for, if not passed, it will generate typings for all files"
	}],
	action: async ({ options }) => {
		const configFilesPaths = [];
		if (options.files) {
			const files = String(options.files).split(",").map((file) => {
				if (file.startsWith("./")) return Path.toAbsolute(file);
				return file;
			});
			if (files?.length) configFilesPaths.push(...files);
		}
		if (configFilesPaths.length === 0) {
			const configFiles = await getFilesFromDirectory(srcPath("config"));
			configFilesPaths.push(...configFiles);
		}
		const failed = (await Promise.allSettled(configFilesPaths.map((path) => filesOrchestrator.add(Path.toRelative(path))))).filter((r) => r.status === "rejected");
		if (failed.length) console.warn(`Failed to process ${failed.length} files`);
		await typeGenerator.generateAll();
	}
});
//#endregion
export { typingsGeneratorCommand };

//# sourceMappingURL=typings-generator.command.mjs.map