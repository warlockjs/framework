import { srcPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "../dev-server/path.mjs";
import { getFilesFromDirectory } from "../dev-server/utils.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { SeedersManager } from "./seeds/seeders.manager.mjs";
import { dataSourceRegistry } from "@warlock.js/cascade";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/database/seed-command-action.ts
async function clearAllTables(datasource) {
	const tables = await datasource.driver.blueprint.listTables();
	for (const table of tables) await datasource.driver.truncateTable(table, { cascade: true });
}
/**
* Run database seeds.
*
* @example
* ```ts
* import { seedCommandAction } from "@warlock.js/core";
*
* await seedCommandAction({
*   command: "seed",
*   options: { fresh: true, list: false }
* });
* ```
*/
async function seedCommandAction(options) {
	const { path, fresh, transaction, list } = options.options;
	const datasource = dataSourceRegistry.get();
	if (fresh) await clearAllTables(datasource);
	if (list) {
		const seedFiles = await listSeedsFiles();
		if (seedFiles.length === 0) {
			console.log("No seeds found.");
			return;
		}
		const seedersManager = new SeedersManager();
		seedersManager.register(...seedFiles);
		const seeds = seedersManager.sort().seeders.map((seed) => {
			return {
				name: seed.name,
				order: seed.order,
				enabled: seed.enabled
			};
		});
		console.table(seeds);
		console.log(`Total Seeds: ${colors.blueBright(seeds.length)}, enabled: ${colors.greenBright(seeds.filter((seed) => seed.enabled !== false).length)}, disabled: ${colors.redBright(seeds.filter((seed) => seed.enabled === false).length)}`);
		return;
	}
	const seeds = path ? [await loadSeedFile(Path.toAbsolute(path))] : await listSeedsFiles();
	const seedersManager = new SeedersManager();
	seedersManager.register(...seeds);
	await seedersManager.run(transaction);
}
async function listSeedsFiles() {
	const seedsFiles = await getFilesFromDirectory(srcPath("app"), "*/seeds/*.ts");
	const seeds = [];
	for (const seedFile of seedsFiles) {
		const seed = await loadSeedFile(seedFile);
		seeds.push(seed);
	}
	return seeds;
}
async function loadSeedFile(absPath) {
	const relativePath = Path.toRelative(absPath);
	const seedImport = await filesOrchestrator.load(relativePath);
	if (!seedImport || !seedImport.default) throw new Error(`Seeder file ${relativePath} does not export a default seeder.`);
	return seedImport.default;
}
//#endregion
export { seedCommandAction };

//# sourceMappingURL=seed-command-action.mjs.map