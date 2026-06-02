import { appPath } from "../../../../utils/paths.mjs";
import "../../../../utils/index.mjs";
import { migrationAlterStub, migrationStub } from "../templates/stubs.mjs";
import { parseName } from "../utils/name-parser.mjs";
import { ensureDirectoryAsync, putFileAsync, setDryRun } from "../utils/writer.mjs";
import { parseColumnDsl } from "./column-dsl-parser.mjs";
import { colors } from "@mongez/copper";
import path from "node:path";
//#region ../../@warlock.js/core/src/cli/commands/generate/generators/migration.generator.ts
/**
* Generate a migration file for a model
*/
/**
* Create a migration file for a model
*/
async function createMigrationFile(moduleName, entityName, options = {}) {
	const entity = parseName(entityName);
	const now = /* @__PURE__ */ new Date();
	const migrationFileName = `${`${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`}-${entity.kebab}.migration.ts`;
	const migrationsPath = path.join(appPath(), moduleName, "models", entity.kebab, "migrations");
	await ensureDirectoryAsync(migrationsPath);
	const addParams = options.add;
	const dropParams = options.drop;
	const renameParams = options.rename;
	const timestamps = options.timestamps !== "false" && options.timestamps !== false;
	let migrationContent = "";
	if (addParams || dropParams || renameParams) {
		const parsedAdd = parseColumnDsl(addParams || "");
		const helpersSet = /* @__PURE__ */ new Set();
		const addLines = parsedAdd.map((col) => {
			helpersSet.add(col.helper);
			return `    ${col.name}: ${col.helper}()${col.modifiers.join("")},`;
		});
		let formattedDrop = void 0;
		if (dropParams) formattedDrop = JSON.stringify(dropParams.split(",").map((s) => s.trim()));
		let formattedRename = void 0;
		if (renameParams) {
			const obj = {};
			renameParams.split(",").map((s) => s.trim()).forEach((p) => {
				const [oldN, newN] = p.split(":").map((s) => s.trim());
				if (oldN && newN) obj[oldN] = newN;
			});
			formattedRename = JSON.stringify(obj, null, 2).replace(/\n/g, "\n  ");
		}
		migrationContent = migrationAlterStub(entity, {
			add: addLines.length > 0 ? addLines.join("\n") : void 0,
			drop: formattedDrop,
			rename: formattedRename,
			imports: Array.from(helpersSet)
		});
	} else migrationContent = migrationStub(entity, { timestamps });
	const migrationFilePath = path.join(migrationsPath, migrationFileName);
	await putFileAsync(migrationFilePath, migrationContent);
	return migrationFilePath;
}
/**
* Generate a migration file for a model
*/
async function generateMigration(data) {
	const modelPath = data.args[0];
	if (!modelPath) {
		console.log(colors.red("Error: Model path is required"));
		console.log(colors.gray("Usage: warlock gen.migration <model-path>"));
		console.log(colors.gray("Example: warlock gen.migration products/product"));
		return;
	}
	const [moduleName, entityName] = modelPath.split("/");
	if (!moduleName || !entityName) {
		console.log(colors.red("Error: Invalid model path format. Expected: <module>/<entity>"));
		console.log(colors.gray("Example: warlock gen.migration products/product"));
		return;
	}
	setDryRun(Boolean(data.options.dryRun));
	const migrationFilePath = await createMigrationFile(moduleName, entityName, data.options);
	console.log(colors.cyan(`\nâœ¨ Migration file created at: ${path.relative(appPath(), migrationFilePath)}`));
}
//#endregion
export { createMigrationFile, generateMigration };

//# sourceMappingURL=migration.generator.mjs.map