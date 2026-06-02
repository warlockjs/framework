import { resourceStub } from "../templates/stubs.mjs";
import { parseModulePath, parseName } from "../utils/name-parser.mjs";
import { putFileAsync, setDryRun } from "../utils/writer.mjs";
import { componentExists, ensureComponentDirectory, moduleExists, resolveComponentPath } from "../utils/path-resolver.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/cli/commands/generate/generators/resource.generator.ts
async function generateResource(data) {
	const input = data.args[0];
	if (!input) {
		console.log(colors.red("Error: Resource name is required"));
		console.log(colors.yellow("Usage: warlock create.resource <module>/<name>"));
		console.log(colors.yellow("Example: warlock create.resource users/user"));
		process.exit(1);
	}
	const { module, name: componentName } = parseModulePath(input);
	if (!module) {
		console.log(colors.red("Error: Module name is required"));
		console.log(colors.yellow("Usage: warlock create.resource <module>/<name>"));
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
	if (await componentExists(module, "resources", `${name.kebab}.resource`) && !force) {
		console.log(colors.red(`Error: Resource "${name.kebab}.resource.ts" already exists`));
		console.log(colors.yellow("Use --force to overwrite"));
		process.exit(1);
	}
	await ensureComponentDirectory(module, "resources");
	await putFileAsync(resolveComponentPath(module, "resources", `${name.kebab}.resource`), resourceStub(name));
	console.log(colors.cyan(`\nâœ¨ Resource "${name.pascal}Resource" generated successfully!`));
}
//#endregion
export { generateResource };

//# sourceMappingURL=resource.generator.mjs.map