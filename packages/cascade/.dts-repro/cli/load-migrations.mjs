import { migrationRunner } from "../migration/migration-runner.mjs";
import path from "path";
import fastGlob from "fast-glob";
import { pathToFileURL } from "url";
//#region ../../@warlock.js/cascade/src/cli/load-migrations.ts
const DEFAULT_PATTERN = "./migrations/**/*.{ts,js,mjs,cjs}";
/**
* Resolve the migration name from a filename. Mirrors warlock-core's
* convention: drop the extension, strip a trailing `-migration` /
* `_migration` suffix.
*/
function inferNameFromFile(file) {
	return path.basename(file).split(".")[0].replace(/-migration$/, "").replace(/_migration$/, "");
}
/**
* Extract a leading `MM-DD-YYYY_HH-MM-SS` (or `DD-MM-YYYY_HH-MM-SS`)
* timestamp from a migration filename so the runner can sort migrations
* deterministically. Returns `undefined` when no timestamp is present.
*/
function inferCreatedAtFromFile(file) {
	const match = path.basename(file).match(/^(\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2})/);
	return match ? match[1] : void 0;
}
/**
* Produce a helpful CLI error when Node refuses to import a `.ts` migration
* file directly — the standalone Cascade CLI ships no TS transpiler, and
* users hitting this error need to invoke through `tsx`/`tsm` or compile
* their migrations to JS first.
*/
function explainImportFailure(file, error) {
	const message = error instanceof Error ? error.message : String(error);
	if (file.endsWith(".ts") || file.endsWith(".tsx")) return /* @__PURE__ */ new Error(`Cascade CLI: failed to load TypeScript migration ${file}.\nNode cannot import .ts files natively — invoke the CLI through a TS runtime, e.g.:\n  npx tsx node_modules/.bin/cascade migrate\nOr pre-compile migrations to JS before running.\nOriginal error: ${message}`);
	return /* @__PURE__ */ new Error(`Cascade CLI: failed to load migration ${file}. ${message}`);
}
/**
* Discover migration files via `fast-glob`, dynamic-import each, and register
* the default export on `migrationRunner`. Migration name and `createdAt`
* are inferred from the filename when the class does not declare them.
*
* Default glob: `./migrations/&#42;&#42;/&#42;.{ts,js,mjs,cjs}` from `process.cwd()`.
* Pass an explicit pattern to override.
*
* @returns Number of migration files registered.
*
* @example
* await loadMigrations();
* await loadMigrations("./db/schema/&#42;.migration.js");
*/
async function loadMigrations(pattern) {
	const files = await fastGlob(pattern ?? DEFAULT_PATTERN, {
		absolute: true,
		cwd: process.cwd(),
		onlyFiles: true
	});
	for (const file of files) {
		const fileUrl = pathToFileURL(file).href;
		let loadedModule;
		try {
			loadedModule = await import(fileUrl);
		} catch (error) {
			throw explainImportFailure(file, error);
		}
		const MigrationClass = loadedModule.default;
		if (!MigrationClass) throw new Error(`Cascade CLI: ${file} must export a default migration class.`);
		if (!MigrationClass.migrationName) MigrationClass.migrationName = inferNameFromFile(file);
		if (!MigrationClass.createdAt) {
			const createdAt = inferCreatedAtFromFile(file);
			if (createdAt) MigrationClass.createdAt = createdAt;
		}
		migrationRunner.register(MigrationClass);
	}
	return files.length;
}
//#endregion
export { loadMigrations };

//# sourceMappingURL=load-migrations.mjs.map