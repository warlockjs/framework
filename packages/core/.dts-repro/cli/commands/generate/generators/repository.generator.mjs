import { repositoryStub } from "../templates/stubs.mjs";
import { parseModulePath, parseName } from "../utils/name-parser.mjs";
import { putFileAsync, setDryRun } from "../utils/writer.mjs";
import { componentExists, ensureComponentDirectory, moduleExists, resolveComponentPath } from "../utils/path-resolver.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/cli/commands/generate/generators/repository.generator.ts
async function generateRepository(data) {
	const input = data.args[0];
	if (!input) {
		console.log(colors.red("Error: Repository name is required"));
		console.log(colors.yellow("Usage: warlock create.repository <module>/<name>"));
		console.log(colors.yellow("Example: warlock create.repository users/user"));
		process.exit(1);
	}
	const { module, name: componentName } = parseModulePath(input);
	if (!module) {
		console.log(colors.red("Error: Module name is required"));
		console.log(colors.yellow("Usage: warlock create.repository <module>/<name>"));
		process.exit(1);
	}
	if (!await moduleExists(module)) {
		console.log(colors.red(`Error: Module "${module}" does not exist`));
		console.log(colors.yellow(`Run: warlock create.module ${module}`));
		process.exit(1);
	}
	const name = parseName(componentName);
	const force = data.options.force || data.options.f;
	setDryRun(Boolean(data.options.dryRun));
	if (await componentExists(module, "repositories", `${name.kebab}.repository`) && !force) {
		console.log(colors.red(`Error: Repository "${name.kebab}.repository.ts" already exists`));
		console.log(colors.yellow("Use --force to overwrite"));
		process.exit(1);
	}
	await ensureComponentDirectory(module, "repositories");
	await putFileAsync(resolveComponentPath(module, "repositories", `${name.kebab}.repository`), repositoryStub(name));
	console.log(colors.cyan(`\nâœ¨ Repository "${name.pascal}Repository" generated successfully!`));
}
//#endregion
export { generateRepository };

//# sourceMappingURL=repository.generator.mjs.map