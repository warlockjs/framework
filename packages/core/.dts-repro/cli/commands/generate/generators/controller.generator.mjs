import { controllerStub, schemaStub } from "../templates/stubs.mjs";
import { parseModulePath, parseName } from "../utils/name-parser.mjs";
import { putFileAsync, setDryRun } from "../utils/writer.mjs";
import { componentExists, ensureComponentDirectory, moduleExists, resolveComponentPath } from "../utils/path-resolver.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/cli/commands/generate/generators/controller.generator.ts
async function generateController(data) {
	const input = data.args[0];
	if (!input) {
		console.log(colors.red("Error: Controller name is required"));
		console.log(colors.yellow("Usage: warlock create.controller <module>/<name>"));
		console.log(colors.yellow("Example: warlock create.controller users/create-user"));
		process.exit(1);
	}
	const { module, name: componentName } = parseModulePath(input);
	if (!module) {
		console.log(colors.red("Error: Module name is required"));
		console.log(colors.yellow("Usage: warlock create.controller <module>/<name>"));
		process.exit(1);
	}
	if (!await moduleExists(module)) {
		console.log(colors.red(`Error: Module "${module}" does not exist`));
		console.log(colors.yellow(`Run: warlock create.module ${module}`));
		process.exit(1);
	}
	const name = parseName(componentName);
	const withValidation = data.options.withValidation || data.options.v;
	const force = data.options.force || data.options.f;
	setDryRun(Boolean(data.options.dryRun));
	const controllerPath = resolveComponentPath(module, "controllers", `${name.kebab}.controller`);
	if (await componentExists(module, "controllers", `${name.kebab}.controller`) && !force) {
		console.log(colors.red(`Error: Controller "${name.kebab}.controller.ts" already exists`));
		console.log(colors.yellow("Use --force to overwrite"));
		process.exit(1);
	}
	await ensureComponentDirectory(module, "controllers");
	await putFileAsync(controllerPath, controllerStub(name, { withValidation: !!withValidation }));
	if (withValidation) {
		await ensureComponentDirectory(module, "schema");
		await putFileAsync(resolveComponentPath(module, "schema", `${name.kebab}.schema`), schemaStub(name));
	}
	console.log(colors.cyan(`\nâœ¨ Controller "${name.camel}" generated successfully!`));
}
//#endregion
export { generateController };

//# sourceMappingURL=controller.generator.mjs.map