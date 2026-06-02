import { migrationStub, modelStub } from "../templates/stubs.mjs";
import { parseModulePath, singularName } from "../utils/name-parser.mjs";
import { ensureDirectoryAsync, putFileAsync, setDryRun } from "../utils/writer.mjs";
import { componentExists, moduleExists, resolveModulePath } from "../utils/path-resolver.mjs";
import { colors } from "@mongez/copper";
import path from "node:path";
//#region ../../@warlock.js/core/src/cli/commands/generate/generators/model.generator.ts
async function generateModel(data) {
	const input = data.args[0];
	if (!input) {
		console.log(colors.red("Error: Model name is required"));
		console.log(colors.yellow("Usage: warlock create.model <module>/<name>"));
		console.log(colors.yellow("Example: warlock create.model users/user"));
		process.exit(1);
	}
	const { module, name: componentName } = parseModulePath(input);
	if (!module) {
		console.log(colors.red("Error: Module name is required"));
		console.log(colors.yellow("Usage: warlock create.model <module>/<name>"));
		process.exit(1);
	}
	if (!await moduleExists(module)) {
		console.log(colors.red(`Error: Module "${module}" does not exist`));
		console.log(colors.yellow(`Run: warlock create.module ${module}`));
		process.exit(1);
	}
	const name = singularName(componentName);
	const force = data.options.force || data.options.f;
	setDryRun(Boolean(data.options.dryRun));
	const withResource = data.options.withResource || data.options.rs;
	const tableName = data.options.table || name.plural.snake;
	const modelDir = path.join(resolveModulePath(module), "models", name.kebab);
	const modelPath = path.join(modelDir, `${name.kebab}.model.ts`);
	if (await componentExists(module, `models/${name.kebab}`, `${name.kebab}.model`) && !force) {
		console.log(colors.red(`Error: Model "${name.kebab}" already exists`));
		console.log(colors.yellow("Use --force to overwrite"));
		process.exit(1);
	}
	await ensureDirectoryAsync(modelDir);
	await ensureDirectoryAsync(path.join(modelDir, "migrations"));
	await putFileAsync(modelPath, modelStub(name, {
		tableName,
		withResource: !!withResource
	}));
	const indexContent = `export * from "./${name.kebab}.model";
`;
	await putFileAsync(path.join(modelDir, "index.ts"), indexContent);
	const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "_").split(".")[0];
	await putFileAsync(path.join(modelDir, "migrations", `${timestamp}_${name.kebab}.migration.ts`), migrationStub(name, { timestamps: data.options.timestamps !== "false" && data.options.timestamps !== false }));
	console.log(colors.cyan(`\nâœ¨ Model "${name.pascal}" generated successfully!`));
	console.log(colors.gray(`\nNext steps:`));
	console.log(colors.gray(`  1. Update model schema in ${name.kebab}.model.ts`));
	console.log(colors.gray(`  2. Update migration in migrations/${timestamp}_${name.kebab}.migration.ts`));
	console.log(colors.gray(`  3. Run migration: warlock migrate`));
}
//#endregion
export { generateModel };

//# sourceMappingURL=model.generator.mjs.map